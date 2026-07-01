
import User from '../model/User.js';
import LoyaltyTransaction from '../model/LoyaltyTransaction.js';

export async function awardLoyaltyPoints({ userId, reason, refId, refModel, desc }) {
  const POINTS = 1; 
  const EXPIRY_DAYS = 180;

  await User.findByIdAndUpdate(userId, {
    $inc: {
      loyaltyPoints: POINTS,
      ...(reason === 'order'  && { totalOrdersEarned:  1 }),
      ...(reason === 'review' && { totalReviewsEarned: 1 }),
    },
  });

  await LoyaltyTransaction.create({
    user:      userId,
    type:      'earned',
    reason,
    points:    POINTS,
    refId,
    refModel,
    desc,
    expiresAt: new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000),
  });
}