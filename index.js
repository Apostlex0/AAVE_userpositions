const { ethers } = require("ethers");
const {
  UiPoolDataProvider,
  UiIncentiveDataProvider,
  ChainId,
} = require("@aave/contract-helpers");
const { formatUserSummary, formatReserves } = require("@aave/math-utils");
const dayjs = require("dayjs");
const fs = require("fs");

// Initialize Base provider
const provider = new ethers.providers.JsonRpcProvider(
  "https://base-mainnet.g.alchemy.com/v2/Qea_8BCwdssd0U3jznguIULnLVu_OT0_"
);

// Contract addresses for Aave V3 on Base
const POOL_ADDRESSES_PROVIDER = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D";
const POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const UI_POOL_DATA_PROVIDER = "0x68100bD5345eA474D93577127C11F39FF8463e93";

// Token address to symbol mapping
const TOKEN_SYMBOLS = {
  "0x4200000000000000000000000000000000000006": "WETH",
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": "cbETH",
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": "USDbC",
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": "wstETH",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": "weETH",
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": "cbBTC",
  "0x2416092f143378750bb29b79ed961ab195cceea5": "ezETH",
  "0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee": "GHO",
  "0xedfa23602d0ec14714057867a78d01e94176bea0": "wrsETH",
  "0xecac9c5f704e954931349da37f60e39f515c11c1": "LBTC",
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": "EURC",
};

// Initialize Aave data providers for Base network
const poolDataProviderContract = new UiPoolDataProvider({
  uiPoolDataProviderAddress: UI_POOL_DATA_PROVIDER,
  provider,
  chainId: ChainId.base,
});

// Create a function to read addresses from a file if it exists, otherwise create the file
function getAddresses() {
  if (!fs.existsSync("./addresses.json")) {
    // Create a default list with a few addresses
    const defaultAddresses = [
      "0xe8Bf6904a1799cDf793aFDD223F3Eed0C4B98CE3",
      "0x8252C3Ad7008464A618B6b28690DFB30D17A4910",
      "0x4Ae8912F26AEc381b5ed4a45Fca2152Aaa3561DF",
      "0x3e35307965D847Dccbb19462b4428b369F9c3B68",
    ];
    fs.writeFileSync(
      "./addresses.json",
      JSON.stringify(defaultAddresses, null, 2)
    );
    return defaultAddresses;
  }

  try {
    // Read addresses from file
    const addresses = JSON.parse(fs.readFileSync("./addresses.json", "utf8"));
    console.log(`Loaded ${addresses.length} addresses from addresses.json`);
    return addresses;
  } catch (error) {
    console.error("Error reading addresses file:", error);
    return [];
  }
}

// Get the list of user addresses to fetch data for
const userAddresses = getAddresses();

// Track cumulative metrics across all users
let cumulativeMetrics = {
  totalLiquidityUSD: 0,
  totalCollateralUSD: 0,
  totalBorrowsUSD: 0,
  addressesWithPositions: 0,
  addressesWithBorrows: 0,
  uniqueAssets: new Set(),
};

// Function to check if a contract exists
async function checkContract(address) {
  try {
    const code = await provider.getCode(address);
    return code !== "0x";
  } catch (error) {
    console.error(`Error checking contract ${address}:`, error.message);
    return false;
  }
}

async function fetchUserData(address) {
  try {
    // Fetch reserves data
    const reserves = await poolDataProviderContract.getReservesHumanized({
      lendingPoolAddressProvider: POOL_ADDRESSES_PROVIDER,
    });

    // Fetch user reserves data
    const userReserves =
      await poolDataProviderContract.getUserReservesHumanized({
        lendingPoolAddressProvider: POOL_ADDRESSES_PROVIDER,
        user: address,
      });

    const currentTimestamp = dayjs().unix();

    // Format reserves data using the SDK's formatter
    const formattedReserves = formatReserves({
      reserves: reserves.reservesData,
      currentTimestamp,
      marketReferenceCurrencyDecimals:
        reserves.baseCurrencyData.marketReferenceCurrencyDecimals,
      marketReferencePriceInUsd:
        reserves.baseCurrencyData.marketReferenceCurrencyPriceInUsd,
    });

    // Format user summary using the SDK's formatter
    const userSummary = formatUserSummary({
      currentTimestamp,
      marketReferencePriceInUsd:
        reserves.baseCurrencyData.marketReferenceCurrencyPriceInUsd,
      marketReferenceCurrencyDecimals:
        reserves.baseCurrencyData.marketReferenceCurrencyDecimals,
      userReserves: userReserves.userReserves,
      formattedReserves,
      userEmodeCategoryId: userReserves.userEmodeCategoryId,
    });

    // Debug information
    console.log(`\nData for address ${address}:`);
    console.log("----------------------------------------");

    // Track if user has any active positions
    let hasActivePositions = false;
    let hasActiveBorrows = false;
    let userHoldings = [];

    // Track raw borrow amounts for debugging
    let totalVariableDebtRaw = 0;
    let totalStableDebtRaw = 0;
    let totalDebtTokensUSD = 0;

    // Log user reserves details if they exist
    if (userReserves.userReserves && userReserves.userReserves.length > 0) {
      const activeReserves = userReserves.userReserves.filter((reserve) => {
        const hasBalance = Number(reserve.scaledATokenBalance || 0) > 0;
        const hasVariableDebt = Number(reserve.scaledVariableDebt || 0) > 0;
        const hasStableDebt = Number(reserve.principalStableDebt || 0) > 0;
        return hasBalance || hasVariableDebt || hasStableDebt;
      });

      if (activeReserves.length > 0) {
        hasActivePositions = true;
        console.log("\nAsset Positions:");

        activeReserves.forEach((reserve) => {
          const symbol =
            TOKEN_SYMBOLS[reserve.underlyingAsset.toLowerCase()] ||
            reserve.underlyingAsset;

          // Get token decimals and price from reserves data
          const tokenInfo = reserves.reservesData.find(
            (r) =>
              r.underlyingAsset.toLowerCase() ===
              reserve.underlyingAsset.toLowerCase()
          );
          const decimals = tokenInfo ? tokenInfo.decimals : 18;

          // Find the formatted reserve to get price data
          const formattedReserve = formattedReserves.find(
            (r) =>
              r.underlyingAsset.toLowerCase() ===
              reserve.underlyingAsset.toLowerCase()
          );
          const priceInUSD = formattedReserve ? formattedReserve.priceInUSD : 0;

          // Add asset to unique assets set
          cumulativeMetrics.uniqueAssets.add(symbol);

          // Create holding object
          let holding = {
            symbol,
            asset: reserve.underlyingAsset,
          };

          if (Number(reserve.scaledATokenBalance || 0) > 0) {
            const supplyBalance = ethers.utils.formatUnits(
              reserve.scaledATokenBalance || 0,
              decimals
            );
            holding.supplyBalance = supplyBalance;
            console.log(`\n${symbol}:`);
            console.log(`  Supply Balance: ${supplyBalance}`);
          }

          if (
            Number(reserve.scaledVariableDebt || 0) > 0 ||
            Number(reserve.principalStableDebt || 0) > 0
          ) {
            hasActiveBorrows = true;

            if (Number(reserve.scaledVariableDebt || 0) > 0) {
              const variableDebtRaw = Number(reserve.scaledVariableDebt);
              totalVariableDebtRaw += variableDebtRaw;

              const variableDebt = ethers.utils.formatUnits(
                reserve.scaledVariableDebt || 0,
                decimals
              );
              const variableDebtNum = Number(variableDebt);
              const variableDebtUSD = variableDebtNum * priceInUSD;
              totalDebtTokensUSD += variableDebtUSD;

              holding.variableDebt = variableDebt;
              holding.variableDebtUSD = variableDebtUSD;

              if (!holding.symbol) console.log(`\n${symbol}:`);
              console.log(
                `  Variable Debt: ${variableDebt} (~$${variableDebtUSD.toFixed(
                  2
                )})`
              );
            }

            if (Number(reserve.principalStableDebt || 0) > 0) {
              const stableDebtRaw = Number(reserve.principalStableDebt);
              totalStableDebtRaw += stableDebtRaw;

              const stableDebt = ethers.utils.formatUnits(
                reserve.principalStableDebt || 0,
                decimals
              );
              const stableDebtNum = Number(stableDebt);
              const stableDebtUSD = stableDebtNum * priceInUSD;
              totalDebtTokensUSD += stableDebtUSD;

              holding.stableDebt = stableDebt;
              holding.stableDebtUSD = stableDebtUSD;

              if (!holding.symbol) console.log(`\n${symbol}:`);
              console.log(
                `  Stable Debt: ${stableDebt} (~$${stableDebtUSD.toFixed(2)})`
              );
            }
          }

          if (
            holding.supplyBalance ||
            holding.variableDebt ||
            holding.stableDebt
          ) {
            holding.usedAsCollateral = reserve.usageAsCollateralEnabledOnUser;
            console.log(`  Used as Collateral: ${holding.usedAsCollateral}`);
            userHoldings.push(holding);
          }
        });
      } else {
        console.log("No active positions found");
      }
    } else {
      console.log("No reserves data found for this user");
    }

    // Find the correct position data in userSummary
    const userSummaryData =
      userSummary && typeof userSummary === "object" ? userSummary : {};

    // Debug: Print raw borrow details
    if (hasActiveBorrows) {
      console.log("\nDEBUG - Borrow Details:");
      console.log(`  Total Variable Debt Raw: ${totalVariableDebtRaw}`);
      console.log(`  Total Stable Debt Raw: ${totalStableDebtRaw}`);
      console.log(
        `  Total Debt in USD (calculated from token prices): $${totalDebtTokensUSD.toFixed(
          2
        )}`
      );
      console.log(
        `  Total Borrows USD (from userSummary): $${Number(
          userSummaryData.totalBorrowsUSD || 0
        ).toFixed(6)}`
      );

      // Detailed log of userSummary structure for debugging
      console.log("\nDEBUG - userSummary structure:");
      if (userSummaryData) {
        console.log(
          `  Has totalBorrowsUSD property: ${userSummaryData.hasOwnProperty(
            "totalBorrowsUSD"
          )}`
        );
        console.log(
          `  Raw totalBorrowsUSD value: ${userSummaryData.totalBorrowsUSD}`
        );
      } else {
        console.log("  userSummaryData is undefined or null");
      }
    }

    // Update cumulative metrics
    if (hasActivePositions) {
      cumulativeMetrics.addressesWithPositions++;
      cumulativeMetrics.totalLiquidityUSD += Number(
        userSummaryData.totalLiquidityUSD || 0
      );
      cumulativeMetrics.totalCollateralUSD += Number(
        userSummaryData.totalCollateralUSD || 0
      );
      cumulativeMetrics.totalBorrowsUSD += Number(
        userSummaryData.totalBorrowsUSD || 0
      );

      if (hasActiveBorrows) {
        cumulativeMetrics.addressesWithBorrows++;
        // Add to borrows using our calculated value as backup
        if (
          Number(userSummaryData.totalBorrowsUSD || 0) <= 0 &&
          totalDebtTokensUSD > 0
        ) {
          console.log(
            `  Using calculated debt value instead of SDK value: $${totalDebtTokensUSD.toFixed(
              2
            )}`
          );
          cumulativeMetrics.totalBorrowsUSD += totalDebtTokensUSD;
        }
      }
    }

    console.log("\nAccount Metrics:");
    console.log("----------------------------------------");
    console.log(
      `Total Liquidity (USD): $${Number(
        userSummaryData.totalLiquidityUSD || 0
      ).toFixed(2)}`
    );
    console.log(
      `Total Collateral (USD): $${Number(
        userSummaryData.totalCollateralUSD || 0
      ).toFixed(2)}`
    );
    console.log(
      `Total Borrows (USD): $${Number(
        userSummaryData.totalBorrowsUSD || 0
      ).toFixed(2)}`
    );

    // Calculate health factor
    let healthFactor = "N/A (no borrows)";

    if (userSummaryData.healthFactor) {
      if (userSummaryData.healthFactor === "-1") {
        healthFactor = "N/A (no borrows)";
      } else if (Number(userSummaryData.totalBorrowsUSD) > 0) {
        // If user has borrows, show health factor
        healthFactor = Number(userSummaryData.healthFactor).toFixed(4);
      }
    }

    console.log(`Health Factor: ${healthFactor}`);
    console.log(
      `Available Borrows (USD): $${Number(
        userSummaryData.availableBorrowsUSD || 0
      ).toFixed(2)}`
    );
    console.log(
      `Current Liquidation Threshold: ${Number(
        userSummaryData.currentLiquidationThreshold || 0
      ).toFixed(2)}%`
    );
    console.log("----------------------------------------\n");

    // Return data for potential further processing
    return {
      address,
      hasActivePositions,
      hasActiveBorrows,
      holdings: userHoldings,
      metrics: {
        totalLiquidityUSD: Number(userSummaryData.totalLiquidityUSD || 0),
        totalCollateralUSD: Number(userSummaryData.totalCollateralUSD || 0),
        totalBorrowsUSD: Number(userSummaryData.totalBorrowsUSD || 0),
        calculatedDebtUSD: totalDebtTokensUSD,
        healthFactor: healthFactor,
        availableBorrowsUSD: Number(userSummaryData.availableBorrowsUSD || 0),
        currentLiquidationThreshold: Number(
          userSummaryData.currentLiquidationThreshold || 0
        ),
      },
    };
  } catch (error) {
    if (error.message.includes("find")) {
      console.log(`\nNo active positions found for address ${address}\n`);
    } else {
      console.error(
        `Error fetching data for address ${address}:`,
        error.message
      );
    }
    return null;
  }
}

async function main() {
  console.log("Starting to fetch Aave user positions data...\n");

  // Check if contracts exist
  console.log("Checking if Aave contracts exist on Base network...");
  const poolDataProviderExists = await checkContract(UI_POOL_DATA_PROVIDER);
  const poolAddressesProviderExists = await checkContract(
    POOL_ADDRESSES_PROVIDER
  );
  const poolExists = await checkContract(POOL);

  console.log(`Pool Data Provider exists: ${poolDataProviderExists}`);
  console.log(`Pool Addresses Provider exists: ${poolAddressesProviderExists}`);
  console.log(`Pool exists: ${poolExists}`);

  if (!poolDataProviderExists || !poolAddressesProviderExists || !poolExists) {
    console.error(
      "One or more Aave contracts do not exist on Base network. Please verify the contract addresses."
    );
    return;
  }

  // Array to store user data
  const usersData = [];

  // Fetch data for each address
  for (const address of userAddresses) {
    const userData = await fetchUserData(address);
    if (userData && userData.hasActivePositions) {
      usersData.push(userData);
    }
    // Add a small delay between requests to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Log cumulative metrics
  console.log("\n============================================");
  console.log("CUMULATIVE METRICS ACROSS ALL USERS");
  console.log("============================================");
  console.log(`Total Users Analyzed: ${userAddresses.length}`);
  console.log(
    `Users with Active Positions: ${cumulativeMetrics.addressesWithPositions}`
  );
  console.log(`Users with Borrows: ${cumulativeMetrics.addressesWithBorrows}`);
  console.log(
    `Total Liquidity (USD): $${cumulativeMetrics.totalLiquidityUSD.toFixed(2)}`
  );
  console.log(
    `Total Collateral (USD): $${cumulativeMetrics.totalCollateralUSD.toFixed(
      2
    )}`
  );
  console.log(
    `Total Borrows (USD): $${cumulativeMetrics.totalBorrowsUSD.toFixed(2)}`
  );
  console.log(
    `Unique Assets Used: ${Array.from(cumulativeMetrics.uniqueAssets).join(
      ", "
    )}`
  );
  console.log("============================================\n");

  console.log("Finished fetching all user positions data.");
}

main().catch(console.error);
