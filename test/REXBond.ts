import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers, web3 } from "hardhat";

// Superfluid SDK imports 
let erc20Abi = require("./abis/erc20");
let deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
let deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
let deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
let { Framework } = require("@superfluid-finance/sdk-core");

// Error handler for Superfluid SDK
let errorHandler = (err: any) => { if (err) throw err; };

// Time travel helpers
export const currentBlockTimestamp = async () => {
  const currentBlockNumber = await ethers.provider.getBlockNumber();
  return (await ethers.provider.getBlock(currentBlockNumber)).timestamp;
};

export const increaseTime = async (seconds: any) => {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
};

describe("REX Bond", function () {
  // Contracts are deployed using the first signer/account by default
  const [owner, alice, bob, charlie, karen];

  let sf, ric, ricx, usdc, usdcx, superSigner;

  const BOND_DURATION = 365 * 24 * 60 * 60; // 1 year
  const MAX_SUPPLY = ethers.parseEther("10000"); // 10,000 
  const YIELD_RATE = 10; // 10% per year

  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployREXBondFixture() {

    // Contracts are deployed using the first signer/account by default
    [owner, alice, bob, charlie, karen] = await ethers.getSigners();


    // Deploy 2 supertokens and the SF framework
    await deployFramework(errorHandler, {
      web3,
      from: owner.address,
    });

    //deploy a fake erc20 token
    let fDAIAddress = await deployTestToken(errorHandler, [":", "fDAI"], {
      web3,
      from: owner.address,
    });

    //deploy a fake erc20 wrapper super token around the fDAI token
    let fDAIxAddress = await deploySuperToken(errorHandler, [":", "fDAI"], {
      web3,
      from: owner.address,
    });

    //deploy a fake erc20 token
    let fUSDCAddress = await deployTestToken(errorHandler, [":", "fUSDC"], {
      web3,
      from: owner.address,
    });

    //deploy a fake erc20 wrapper super token around the fDAI token
    let fUSDCxAddress = await deploySuperToken(errorHandler, [":", "fUSDC"], {
      web3,
      from: owner.address,
    });

    //initialize the superfluid framework...put custom and web3 only bc we are using hardhat locally
    sf = await Framework.create({
      networkName: "custom",
      provider: web3,
      chainId: 31337,
      dataMode: "WEB3_ONLY",
      resolverAddress: process.env.RESOLVER_ADDRESS, //this is how you get the resolver address
      protocolReleaseVersion: "test",
    });

    superSigner = await sf.createSigner({
      signer: owner,
      provider: web3
    });

    // Make RICx
    ricx = await sf.loadSuperToken("fDAIx");
    ric = new ethers.Contract(ricx.underlyingToken.address, erc20Abi, owner);

    // Make USDCx
    usdcx = await sf.loadSuperToken("fUSDCx");
    usdc = new ethers.Contract(usdcx.underlyingToken.address, erc20Abi, owner);


    // Make Some RICx tokens
    await ric.mint(owner.address, MAX_SUPPLY);
    await ric.connect(owner).approve(ricx.address, MAX_SUPPLY);

    let upgradeOperation = ricx.upgrade({
      amount: MAX_SUPPLY
    });
    await upgradeOperation.exec(owner);

    // Make some USDCx tokens
    await usdc.mint(owner.address, MAX_SUPPLY);
    await usdc.connect(owner).approve(usdcx.address, MAX_SUPPLY);

    upgradeOperation = usdcx.upgrade({
      amount: MAX_SUPPLY
    });
    await upgradeOperation.exec(owner);
    
    // Do a transfer operation and send 5K USDC to Alice
    let transferOperation = usdcx.transfer({
      to: alice.address,
      amount: ethers.utils.parseEther("5000")
    });
    await transferOperation.exec(owner);

    // Do a transfer operation and send 5K USDCx to Bob
    transferOperation = usdcx.transfer({
      to: bob.address,
      amount: ethers.utils.parseEther("5000")
    });

    const REXBond = await ethers.getContractFactory("REXBond");
    const bond = await REXBond.deploy(
      owner.address,
      MAX_SUPPLY,
      BOND_DURATION,
      usdcx.address,
      ricx.address,
      YIELD_RATE,
    );


    // We return the contract and the accounts we used
    return { bond, owner, alice, bob, charlie, karen, ricx, usdcx };
  }

  describe("Core", function () {
    const { bond, alice, bob, usdcx } = await loadFixture(deployREXBondFixture);

    it("1.1 - Initialization", async function () {
      expect(await bond.owner()).to.equal(owner.address);
      expect(await bond.maxSupply()).to.equal(MAX_SUPPLY);
      expect(await bond.bondDuration()).to.equal(BOND_DURATION);
      expect(await bond.bondToken()).to.equal(usdcx.address);
      expect(await bond.yieldToken()).to.equal(ricx.address);
      expect(await bond.yieldRate()).to.equal(YIELD_RATE);
      expect(await bond.totalSupply()).to.equal(0);

    });

    it("1.2 - Deposit", async function () {
      

      const depositAmount = ethers.utils.parseEther("5000");

      // Alice deposits 5000 USDCx
      await usdcx.approve(bond.address, depositAmount, { from: alice.address });
      await expect(
        bond.deposit(depositAmount, { from: alice.address })
      ).to.emit(bond, "Deposit").withArgs(alice.address, depositAmount)
      .to.emit(bond, "Transfer").withArgs(ethers.constants.AddressZero, alice.address, depositAmount)

      // Bob deposits 5000 USDCx
      await usdcx.approve(bond.address, depositAmount, { from: bob.address });
      await expect(
        bond.deposit(depositAmount, { from: bob.address })
      ).to.emit(bond, "Deposit").withArgs(bob.address, depositAmount);

      // Check that alice and bob have inbound streams of ricx
      const aliceInboundStream = await sf.cfa.getFlow({
        superToken: ricx.address,
        sender: bond.address,
        receiver: alice.address,
      });

      const bobInboundStream = await sf.cfa.getFlow({
        superToken: ricx.address,
        sender: bond.address,
        receiver: bob.address,
      });

      const expectedFlowRate = depositAmount.mul(YIELD_RATE).div(100).div(BOND_DURATION);
      await expect(aliceInboundStream.flowRate).to.equal(expectedFlowRate);
      await expect(bobInboundStream.flowRate).to.equal(expectedFlowRate);

      // Make sure they got their bond tokens
      await expect(await bond.balanceOf(alice.address)).to.equal(depositAmount);
      await expect(await bond.balanceOf(bob.address)).to.equal(depositAmount);
      
      // Make sure the deposit Tokens are in the bond contract
      await expect(await usdcx.balanceOf(bond.address)).to.equal(depositAmount.mul(2));

    });

    it("1.3 - Withdraw", async function () {

      await expect(
        bond.withdraw(MAX_SUPPLY, { from: alice.address })
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        bond.withdraw(MAX_SUPPLY, { from: owner.address })
      ).to.emit(bond, "Withdraw").withArgs(owner.address, MAX_SUPPLY);

      expect(usdcx.balanceOf(owner.address)).to.equal(MAX_SUPPLY);
    });

    it("1.4 - Repay", async function () { 

      await expect(
        bond.repayBond(MAX_SUPPLY, { from: alice.address })
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        bond.repayBond(MAX_SUPPLY, { from: owner.address })
      ).to.emit(bond, "RepayBond").withArgs(owner.address);

      expect(usdcx.balanceOf(owner.address)).to.equal(0);
      expect(usdcx.balanceOf(bond.address)).to.equal(MAX_SUPPLY);

    });

    it("1.5 - Redeem", async function () {

      await expect(
        bond.redeemBond({ from: alice.address })
      ).to.emit(bond, "Redeem").withArgs(alice.address, MAX_SUPPLY.div(2), MAX_SUPPLY.div(2));

      await expect(
        bond.redeemBond({ from: bob.address })
      ).to.emit(bond, "Redeem").withArgs(bob.address, MAX_SUPPLY.div(2), MAX_SUPPLY.div(2));

      // Check alice and bob got their USDCx back
      expect(usdcx.balanceOf(alice.address)).to.equal(MAX_SUPPLY.div(2));
      expect(usdcx.balanceOf(bob.address)).to.equal(MAX_SUPPLY.div(2));
      expect(usdcx.balanceOf(bond.address)).to.equal(0);

      // Check that alice and bob do not have inbound streams of ricx anymore
      const aliceInboundStream = await sf.cfa.getFlow({
        superToken: ricx.address,
        sender: bond.address,
        receiver: alice.address,
      });

      const bobInboundStream = await sf.cfa.getFlow({
        superToken: ricx.address,
        sender: bond.address,
        receiver: bob.address,
      });

      await expect(aliceInboundStream.flowRate).to.equal(0);
      await expect(bobInboundStream.flowRate).to.equal(0);

    });
  });
});
