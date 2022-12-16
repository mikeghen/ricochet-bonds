# Ricochet Bonds
Ricochet Bonds deliver the interest to bond holders using Superfluid Streams. 


## Protocol Specification

REX Bonds are :
1. Sold for 1 USDC
2. Earn 0.1 RIC per year (12% APR) for the holder
3. Require a lock of 1 year
4. Are collateralized with 0.1 RIC 
5. Will be redeemable for the greater of 1 USDC and 0.1 RIC

### Variables
- `ERC20 depositToken`
- `Supertoken yieldToken`
- `unit term`
- uint perSecondInterestRate


### Methods
- deposit
- redeem
- withdraw
- repay




### Structures
`Claim` - a claim represents a waterdrop claim and contains information about the rate and duration of the claim
  - `token` - the token to use for the waterdrop
  - `rate` - the rate tokens are streamed to the receipient in wei per second
  - `duration` - the amount of time the claim will stream until the claim period ends
  - `deadline` - the date after which this claim is not longer allowed

### Variables
- `mapping(uint => Claim) claims` - a mapping containing the different claim types
- `mapping(address => uint) userClaims`  - maps addresses to their the claim
- `address[] closureQueue` - list of addresses to close streams, addresses are pushed in, `queueIndex` is moved around
- `uint queueIndex` - an index into the `closureQueue` tracks where the front of the queue is
- `address owner` - the owner of the contract (uses `Ownable`)

### Modifiers
- `onlyOwner` - modifies methods so they can only be called by the owner (uses `Ownable`)

### Methods

