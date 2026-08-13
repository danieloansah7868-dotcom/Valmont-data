/* ============================================================================
   Referral program — earn credit when friends buy.

   Flow:
   1. Each customer gets a unique referral code (generated on first access)
   2. New customers sign up with a referral code → tracked in referrals table
   3. When the referred customer's first order is delivered → both parties
      earn credit (REFERRAL_CREDIT_AMOUNT, default GH₵2.00)
   4. Credits can be spent on future orders (applied as discount)

   Functions:
     getOrCreateCode(customerId) — returns the customer's referral code
     recordReferral(referrerCode, referredCustomerId) — links new customer
     rewardFirstOrder(orderId) — called after first delivery, credits both parties
     getBalance(customerId) — current credit balance
     spendCredit(customerId, amount, orderId) — deduct credit from an order
   ============================================================================ */

const crypto = require("crypto");
const { db } = require("./supabase");

const DEFAULT_CREDIT = Number(process.env.REFERRAL_CREDIT_AMOUNT || "2.00");
const MAX_CREDIT_PER_CUSTOMER = Number(process.env.REFERRAL_MAX_CREDIT || "50.00");

/* Generate a short, human-friendly referral code (e.g., "KOFI-A3X2") */
function generateCode(name, phone) {
  const prefix = name
    ? name.split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) || "VD"
    : phone
    ? "VD" + phone.slice(-2)
    : "VD";
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase().slice(0, 4);
  return `${prefix}-${suffix}`;
}

/* Get or create a customer's referral code */
async function getOrCreateCode(customerId) {
  const rows = await db.select({ from: "customers", where: { id: `eq.${customerId}` } });
  if (!rows.length) return null;
  const customer = rows[0];

  if (customer.referral_code) return customer.referral_code;

  // Generate and save
  let code = generateCode(customer.name, customer.phone);
  // Ensure uniqueness (rare collision)
  for (let i = 0; i < 5; i++) {
    const existing = await db.select({ from: "customers", where: { referral_code: `eq.${code}` } });
    if (!existing.length) break;
    code = generateCode(customer.name, customer.phone);
  }

  await db.update("customers", { referral_code: code }, { id: `eq.${customerId}` });
  return code;
}

/* Record that a new customer was referred by a code */
async function recordReferral(referralCode, referredCustomerId) {
  if (!referralCode || !referredCustomerId) return null;

  // Find the referrer
  const referrers = await db.select({ from: "customers", where: { referral_code: `eq.${referralCode.toUpperCase()}` } });
  if (!referrers.length) return null;
  const referrerId = referrers[0].id;

  // Can't refer yourself
  if (referrerId === referredCustomerId) return null;

  // Check if already referred
  const existing = await db.select({ from: "referrals", where: { referred_id: `eq.${referredCustomerId}` } });
  if (existing.length) return existing[0];

  // Record the referral
  await db.update("customers", { referred_by: referralCode.toUpperCase() }, { id: `eq.${referredCustomerId}` });
  const rows = await db.insert("referrals", {
    referrer_id: referrerId,
    referred_id: referredCustomerId,
    status: "pending",
  });
  return rows[0];
}

/* Reward both parties when the referred customer completes their first order */
async function rewardFirstOrder(orderId) {
  // Find the order and its customer
  const orders = await db.select({ from: "orders", where: { id: `eq.${orderId}` } });
  if (!orders.length || !orders[0].customer_id) return null;
  const order = orders[0];

  // Check if this customer has a pending referral
  const referrals = await db.select({
    from: "referrals",
    where: { referred_id: `eq.${order.customer_id}`, status: "eq.pending" },
  });
  if (!referrals.length) return null;
  const referral = referrals[0];

  // Make sure this is actually their FIRST delivered order
  const allOrders = await db.select({
    from: "orders",
    where: { customer_id: `eq.${order.customer_id}`, status: "eq.delivered" },
    order: "created_at.asc",
  });
  if (allOrders.length > 1) {
    // They had previous delivered orders — shouldn't be rewarded
    await db.update("referrals", { status: "expired" }, { id: `eq.${referral.id}` });
    return null;
  }

  // Check credit caps
  const referrerBalance = await getBalance(referral.referrer_id);
  const referredBalance = await getBalance(order.customer_id);

  const now = new Date().toISOString();

  // Credit the referrer
  if (referrerBalance + DEFAULT_CREDIT <= MAX_CREDIT_PER_CUSTOMER) {
    const newBal = referrerBalance + DEFAULT_CREDIT;
    await db.insert("referral_credits", {
      customer_id: referral.referrer_id,
      direction: "earn",
      amount: DEFAULT_CREDIT,
      balance_after: newBal,
      referral_id: referral.id,
      note: `Friend's first order (${order.reference})`,
    });
  }

  // Credit the referred customer
  if (referredBalance + DEFAULT_CREDIT <= MAX_CREDIT_PER_CUSTOMER) {
    const newBal = referredBalance + DEFAULT_CREDIT;
    await db.insert("referral_credits", {
      customer_id: order.customer_id,
      direction: "earn",
      amount: DEFAULT_CREDIT,
      balance_after: newBal,
      referral_id: referral.id,
      note: `Welcome bonus — first order (${order.reference})`,
    });
  }

  // Mark referral as rewarded
  await db.update("referrals", {
    status: "rewarded",
    first_order_id: orderId,
    rewarded_at: now,
  }, { id: `eq.${referral.id}` });

  return { referrer_id: referral.referrer_id, referred_id: order.customer_id, credit: DEFAULT_CREDIT };
}

/* Get current credit balance */
async function getBalance(customerId) {
  const result = await db.rpc("current_referral_credit", { p_customer_id: customerId });
  return Number(result || 0);
}

/* Spend credit on an order (reduces the amount charged) */
async function spendCredit(customerId, amount, orderId) {
  if (!customerId || amount <= 0) return { spent: 0 };

  const balance = await getBalance(customerId);
  if (balance <= 0) return { spent: 0 };

  const toSpend = Math.min(balance, Number(amount));
  const newBal = balance - toSpend;

  await db.insert("referral_credits", {
    customer_id: customerId,
    direction: "spend",
    amount: toSpend,
    balance_after: newBal,
    order_id: orderId,
    note: `Applied to order`,
  });

  return { spent: toSpend, remaining: newBal };
}

/* Get referral stats for a customer */
async function getStats(customerId) {
  const code = await getOrCreateCode(customerId);
  const referrals = await db.select({ from: "referrals", where: { referrer_id: `eq.${customerId}` } });
  const balance = await getBalance(customerId);
  const credited = referrals.filter((r) => r.status === "rewarded").length;
  const pending = referrals.filter((r) => r.status === "pending").length;

  return {
    code,
    total_referred: referrals.length,
    rewarded: credited,
    pending,
    credit_balance: balance,
  };
}

module.exports = {
  DEFAULT_CREDIT,
  MAX_CREDIT_PER_CUSTOMER,
  generateCode,
  getOrCreateCode,
  recordReferral,
  rewardFirstOrder,
  getBalance,
  spendCredit,
  getStats,
};
