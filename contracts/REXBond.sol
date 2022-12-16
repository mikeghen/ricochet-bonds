// Written with assistance from ChatGPT
// All Rights Reserved 2022
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";



contract REXBond is ERC20 {

    // The address of the owner of the contract.
    address public owner;

    // The token contract that is used for the bond.
    ERC20 public bondToken;

    // The token deposited into the contract to mint bond tokens.
    ERC20 public depositToken;

    // The token used to pay yield.
    ERC20 public yieldToken;

    // The yield rate
    uint public interestRate;

    // Bond duration in seconds.
    uint public bondDuration;

    // The maximum supply of bond tokens.
    uint public maxSupply;

    // Closure queue for the bond buyers yield token flows
    address[] public closureQueue;

    // The percision of the interest rate.
    uint constant public interestPercision = 100;

    // The number of seconds in one year.
    uint constant public secondsInYear = 365 * 24 * 60 * 60;

    // Events

    // Emitted when a user deposits tokens into the contract.
    event Deposit(
        address indexed depositor,
        uint amount,
        uint totalBondTokens
    );

    // Emitted when a user redeems their bond tokens for deposit tokens.
    event Redeem(
        address indexed redeemer,
        uint bondTokensRedeemed,
        uint depositTokensTransferred
    );

    // Emitted when the contract owner repays deposit tokens.
    event Repay(
        address indexed owner,
        uint amount,
        uint totalDepositTokens
    );

    // Emitted when the contract owner withdraws deposit tokens from the contract.
    event Withdraw(
        address indexed owner,
        uint amount,
        uint totalDepositTokens
    );

    // Emitted when a stream of yield tokens is started.
    event StartYieldStream(
        address indexed recipient,
        uint amount,
        uint flowRate
    );

    // Emitted when a stream of yield tokens is ended.
    event EndYieldStream(
        address indexed recipient,
        uint amount,
        uint flowRate
    );

    constructor(
        address _owner, 
        uint _maxSupply,
        uint _bondDuration,
        ERC20 _depositToken, 
        SuperToken _yieldToken,
        uint _interestRate
    ) ERC20("REX Bond", "rexBOND") {
        owner = _owner;
        maxSupply = _maxSupply;
        bondDuration = _bondDuration;
        depositToken = _depositToken;
        yieldToken = _yieldToken;
        interestRate = _interestRate;
    }

    // Deposit tokens into the contract.
    function deposit(uint amount) public {
        // Check they're not already a bond holder.
        require(bondToken.balanceOf(msg.sender) == 0, "You are already a bond holder.");

        // Check that the caller is not the contract owner.
        require(msg.sender != owner, "The contract owner cannot deposit tokens.");

        // Transfer the specified amount of tokens from the caller to the contract.
        require(depositToken.transferFrom(msg.sender, address(this), amount), "Transfer failed.");

        // Check that the contract has not reached the maximum supply of bond tokens.
        require(bondToken.totalSupply() + amount <= maxSupply, "Cannot exceed maximum bond token supply.");

        // Mint the specified amount of bond tokens for the caller.
        bondToken.mint(msg.sender, amount);

        // Emit a Deposit event.
        emit Deposit(msg.sender, amount, bondToken.totalSupply());

        // Pay the yield to the caller.
        _payYieldOnAmount(msg.sender, amount);

    }

    function _payYieldOnAmount(address recipient, uint amount) internal {
        int96 flowRate = amount * interestRate / interestPercision / secondsInYear
        // Create a new stream to the recipient with the specified flow rate.
        ISuperfluid(host).callAgreement(
            cfa,
            abi.encodeWithSelector(
                cfa.createFlow.selector,
                yieldToken,
                recipient,
                flowRate,
                new bytes(0) // placeholder
            ),
            new bytes(0)
        );
        // Emit a StartYieldStream event.
        emit StartYieldStream(recipient, amount, flowRate);

        // Add the recipient to the closure queue.
        closureQueue.push(recipient);

    }

    function closeNextInQueue() public {
        // Check that the caller is the contract owner.
        require(msg.sender == owner, "Only the contract owner can close yield token flows.");

        // Check that there is a recipient in the closure queue.
        require(closureQueue.length > 0, "The closure queue is empty.");

        // Get the next recipient in the closure queue.
        address recipient = closureQueue[0];

        // Check if we're ready to close this yield token flow.
         ( uint256 timestamp,
            uint256 flowRate,
            uint256 deposit,
            uint256 owedDeposit) = cfa.getFlow(yieldToken, recipient, address(this));

        // Check that bondDuration has passed and its time to close the yield token flow.
        require(now - timestamp >= bondDuration, "The bond has not expired.");

        // Close the yield token flow for the recipient.
        ISuperfluid(host).callAgreement(
            cfa,
            abi.encodeWithSelector(
                cfa.deleteFlow.selector,
                yieldToken,
                recipient,
                address(this),
                new bytes(0) // placeholder
            ),
            new bytes(0)
        );
        // Emit an EndYieldStream event.
        emit EndYieldStream(recipient, deposit, flowRate);

        // Remove the recipient from the closure queue.
        closureQueue.shift();
    }

    // Redeem bond tokens for deposit tokens.
    function redeem(ERC20 depositToken) public {
        // Check that the caller is not the contract owner.
        require(msg.sender != owner, "The contract owner cannot redeem bond tokens.");

        // Get the caller's balance of bond tokens.
        uint amount = bondToken.balanceOf(msg.sender);

        // Check that the caller has enough bondTokens to redeem.
        require(amount > 0, "Insufficient bond tokens.");

        // Check that the bond has expired.
        require(now >= bondDuration, "The bond has not expired.");

        // Burn the specified amount of bond tokens for the caller.
        bondToken.burn(msg.sender, amount);

        // Calculate the amount of deposit tokens that the caller should receive.
        uint redemptionAmount = amount / bondToken.totalSupply() * depositToken.balanceOf(address(this));


        // Transfer the proportionate amount of deposit tokens from the contract to the caller.
        require(depositToken.transfer(msg.sender, redemptionAmount), "Transfer failed.");

        // Emit a Redeem event.
        emit Redeem(msg.sender, amount, redemptionAmount);
    }

    // Withdraw deposit tokens.
    function withdraw(ERC20 depositToken, uint amount) public {
        // Check that the caller is the contract owner.
        require(msg.sender == owner, "Only the contract owner can withdraw deposit tokens.");

        // Check that the contract has enough deposit tokens to withdraw.
        require(depositToken.balanceOf(address(this)) >= amount, "Insufficient deposit tokens.");

        // Transfer the specified amount of deposit tokens from the contract to the caller.
        require(depositToken.transfer(msg.sender, amount), "Transfer failed.");

        // Emit a Withdraw event.
        emit Withdraw(owner, amount, depositToken.balanceOf(address(this)));
    }  

    // Repay deposit tokens.
    function repay(uint amount) public {
        // Check that the caller is the contract owner.
        require(msg.sender == owner, "Only the contract owner can repay deposit tokens.");

        // Check that the contract owner has enough deposit tokens to repay.
        require(depositToken.balanceOf(msg.sender) >= amount, "Insufficient deposit tokens.");

        // Transfer the specified amount of deposit tokens from the caller to the contract.
        require(depositToken.transferFrom(msg.sender, address(this), amount), "Transfer failed.");
    }
}
