import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/auth.js';
import User from '../model/User.js';
import LoyaltyTransaction from '../model/LoyaltyTransaction.js';

const router = express.Router();


router.get('/summary', protect, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id); 
    const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [user, totalEarnedAgg, totalRedeemedAgg, expiringSoonAgg] = await Promise.all([
      User.findById(userId).select('loyaltyPoints'),
      LoyaltyTransaction.aggregate([
        { $match: { user: userId, points: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$points' } } },
      ]),
      LoyaltyTransaction.aggregate([
        { $match: { user: userId, type: 'redeemed' } },
        { $group: { _id: null, total: { $sum: '$points' } } },
      ]),
      LoyaltyTransaction.aggregate([
        { $match: { user: userId, type: 'earned', expiresAt: { $lte: thirtyDaysAhead, $gte: new Date() } } },
        { $group: { _id: null, total: { $sum: '$points' } } },
      ]),
    ]);

    const totalEarned   = totalEarnedAgg[0]?.total   ?? 0;
    const totalRedeemed = Math.abs(totalRedeemedAgg[0]?.total ?? 0);
    const expiringSoon  = expiringSoonAgg[0]?.total   ?? 0;

    const hasTransactions = totalEarned > 0 || totalRedeemed > 0;

    res.json({
      points:        user?.loyaltyPoints ?? 0,
      totalEarned:   hasTransactions ? totalEarned : user?.loyaltyPoints ?? 0,
      totalRedeemed,
      expiringSoon,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/transactions', protect, async (req, res) => {
  try {
    const userId   = new mongoose.Types.ObjectId(req.user._id); 
    const { type = 'all', page = 1 } = req.query;
    const PAGE_SIZE = 6;

    const filter = { user: userId };
    if (type === 'earned')   filter.type = 'earned';
    if (type === 'redeemed') filter.type = 'redeemed';
    if (type === 'expired')  filter.type = 'expired';

    const [total, transactions] = await Promise.all([
      LoyaltyTransaction.countDocuments(filter),
      LoyaltyTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .select('type points desc createdAt'),
    ]);

    res.json({
      transactions: transactions.map((t) => ({
        id:   t._id,
        type: t.type,
        pts:  t.points,
        desc: t.desc,
        date: t.createdAt,
      })),
      total,
      totalPages: Math.ceil(total / PAGE_SIZE) || 1,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;