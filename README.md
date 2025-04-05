# Aave User Positions Tracker

This script fetches user positions data from Aave V3 Protocol and stores it in a Supabase database.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure Supabase:
   - Create a new project in Supabase
   - Create a new table called `aave_user_positions` with the following columns:
     - `address` (text)
     - `total_liquidity_usd` (numeric)
     - `total_collateral_usd` (numeric)
     - `total_borrows_usd` (numeric)
     - `health_factor` (numeric)
     - `available_borrows_usd` (numeric)
     - `current_liquidation_threshold` (numeric)
     - `timestamp` (timestamp)

3. Update the Supabase configuration:
   - Open `index.js`
   - Replace `YOUR_SUPABASE_URL` with your Supabase project URL
   - Replace `YOUR_SUPABASE_KEY` with your Supabase project API key

## Running the Script

To run the script:

```bash
node index.js
```

The script will:
1. Fetch data for each user address
2. Format the data using Aave's math utilities
3. Store the data in Supabase
4. Log the results to the console

## Output

The script will output:
- Success/error messages for each address
- Formatted user data including:
  - Total liquidity in USD
  - Total collateral in USD
  - Total borrows in USD
  - Health factor
  - Available borrows in USD
  - Current liquidation threshold 