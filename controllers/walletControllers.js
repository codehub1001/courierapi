import prisma from "../prismaClient.js";

// =====================================================
// GET RIDER WALLET
// =====================================================

export const getMyWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find wallet
    let wallet = await prisma.wallet.findUnique({
      where: {
        userId,
      },
      include: {
        transactions: {
          orderBy: {
            createdAt: "desc",
          },
          take: 20,
        },
      },
    });

    // Create wallet if it does not exist
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          userId,
          balance: 0,
        },
        include: {
          transactions: true,
        },
      });
    }

    return res.status(200).json({
      success: true,
      wallet,
    });
  } catch (error) {
    console.error("GET WALLET ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load wallet",
    });
  }
};

// =====================================================
// GET WALLET BALANCE
// =====================================================

export const getWalletBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    let wallet = await prisma.wallet.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
        balance: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          userId,
          balance: 0,
        },
        select: {
          id: true,
          balance: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    return res.status(200).json({
      success: true,
      balance: wallet.balance,
    });
  } catch (error) {
    console.error("GET WALLET BALANCE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load wallet balance",
    });
  }
};

// =====================================================
// GET WALLET TRANSACTIONS
// =====================================================

export const getWalletTransactions = async (req, res) => {
  try {
    const userId = req.user.id;

    const wallet = await prisma.wallet.findUnique({
      where: {
        userId,
      },
    });

    if (!wallet) {
      return res.status(200).json({
        success: true,
        transactions: [],
      });
    }

    const transactions =
      await prisma.walletTransaction.findMany({
        where: {
          walletId: wallet.id,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    return res.status(200).json({
      success: true,
      transactions,
    });
  } catch (error) {
    console.error(
      "GET WALLET TRANSACTIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to load wallet transactions",
    });
  }
};

// =====================================================
// CREDIT RIDER WALLET
// =====================================================
//
// This should normally be called when a delivery is
// successfully completed.
//
// IMPORTANT:
// A delivery can only be credited once.
//

export const creditWallet = async ({
  userId,
  amount,
  referenceId,
  description,
}) => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  if (!amount || amount <= 0) {
    throw new Error("Invalid wallet credit amount");
  }

  if (!referenceId) {
    throw new Error("Reference ID is required");
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // =================================================
      // PREVENT DUPLICATE PAYMENT
      // =================================================

      const existingTransaction =
        await tx.walletTransaction.findFirst({
          where: {
            referenceId,
            type: "CREDIT",
            status: "COMPLETED",
          },
        });

      if (existingTransaction) {
        throw new Error(
          "This delivery has already credited the rider wallet"
        );
      }

      // =================================================
      // FIND OR CREATE WALLET
      // =================================================

      let wallet = await tx.wallet.findUnique({
        where: {
          userId,
        },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId,
            balance: 0,
          },
        });
      }

      // =================================================
      // INCREASE BALANCE
      // =================================================

      const updatedWallet =
        await tx.wallet.update({
          where: {
            id: wallet.id,
          },
          data: {
            balance: {
              increment: amount,
            },
          },
        });

      // =================================================
      // CREATE TRANSACTION
      // =================================================

      const transaction =
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,

            amount,

            type: "CREDIT",

            status: "COMPLETED",

            referenceId,

            description:
              description ||
              "Wallet credit",
          },
        });

      return {
        wallet: updatedWallet,
        transaction,
      };
    }
  );

  return result;
};

// =====================================================
// DEBIT WALLET
// =====================================================
//
// This can later be used for withdrawals.
//

export const debitWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    const { amount, description } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid amount is required",
      });
    }

    const numericAmount = Number(amount);

    const result = await prisma.$transaction(
      async (tx) => {
        const wallet =
          await tx.wallet.findUnique({
            where: {
              userId,
            },
          });

        if (!wallet) {
          throw new Error("Wallet not found");
        }

        if (
          Number(wallet.balance) <
          numericAmount
        ) {
          throw new Error(
            "Insufficient wallet balance"
          );
        }

        const updatedWallet =
          await tx.wallet.update({
            where: {
              id: wallet.id,
            },
            data: {
              balance: {
                decrement: numericAmount,
              },
            },
          });

        const transaction =
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,

              amount: numericAmount,

              type: "DEBIT",

              status: "COMPLETED",

              referenceId: `WD-${Date.now()}`,

              description:
                description ||
                "Wallet debit",
            },
          });

        return {
          wallet: updatedWallet,
          transaction,
        };
      }
    );

    return res.status(200).json({
      success: true,
      message: "Wallet debited successfully",
      wallet: result.wallet,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error("DEBIT WALLET ERROR:", error);

    if (
      error.message ===
      "Insufficient wallet balance"
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to debit wallet",
    });
  }
};