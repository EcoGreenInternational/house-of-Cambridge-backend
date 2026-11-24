/**
 * One-time cleanup for the removed 11:11 storewide discount.
 *
 * The old "Campaign & Global Discount" feature wrote the discount directly into
 * every product (discountPercent, discountPrice, comparePrice and variant prices).
 * Removing the code does not undo that, so run this once against the database.
 *
 *   node scripts/revert-1111-discount.js                      -> dry run (shows what would change)
 *   node scripts/revert-1111-discount.js --apply              -> restores original prices
 *   node scripts/revert-1111-discount.js --apply --drop-collections
 *                                                             -> also drops campaignsettings + discountrequests
 *
 * Only products whose numbers exactly match what the global-discount code produced
 * are touched. Anything else with discountPercent > 0 is listed for manual review.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const APPLY = process.argv.includes('--apply');
const DROP = process.argv.includes('--drop-collections');

const discounted = (amount, pct) => Math.max(0, Math.round(amount * (1 - pct / 100)));

const main = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (check your .env)');
  await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
  const db = mongoose.connection.db;
  const products = db.collection('products');

  const candidates = await products.find({ discountPercent: { $gt: 0 } }).toArray();
  console.log(`Products with discountPercent > 0: ${candidates.length}`);

  const ops = [];
  const skipped = [];

  for (const p of candidates) {
    const pct = Number(p.discountPercent);
    const price = Number(p.price) || 0;
    const compare = Number(p.comparePrice) || 0;
    const discPrice = Number(p.discountPrice) || 0;

    // Global discount set: comparePrice = max(comparePrice, price), discountPrice = round(comparePrice * (1 - pct%))
    if (!(compare >= price && compare > 0 && discPrice === discounted(compare, pct))) {
      skipped.push(p);
      continue;
    }

    const set = { discountPercent: 0, discountPrice: 0 };
    // comparePrice was raised to equal price by the discount code; clear it so no strike-through shows.
    if (compare === price) set.comparePrice = 0;

    if (Array.isArray(p.variants) && p.variants.length) {
      set.variants = p.variants.map((v) => {
        const vCompare = Number(v.comparePrice) || 0;
        const vPrice = Number(v.price) || 0;
        if (vCompare > 0 && vPrice === discounted(vCompare, pct)) {
          return { ...v, price: vCompare, comparePrice: 0 };
        }
        return v;
      });
    }

    ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: set } } });
    console.log(`  revert  ${p.name}  (discountPrice ${discPrice} -> 0, price stays ${price})`);
  }

  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} product(s) that do not match the 11:11 pattern - check these by hand:`);
    skipped.forEach((p) => console.log(`  ${p._id}  ${p.name}  price=${p.price} compare=${p.comparePrice} discountPrice=${p.discountPrice} pct=${p.discountPercent}`));
  }

  if (!APPLY) {
    console.log(`\nDRY RUN: ${ops.length} product(s) would be reverted. Re-run with --apply to write changes.`);
  } else if (ops.length) {
    const res = await products.bulkWrite(ops);
    console.log(`\nReverted ${res.modifiedCount} product(s).`);
  } else {
    console.log('\nNothing to revert.');
  }

  if (APPLY && DROP) {
    for (const name of ['campaignsettings', 'discountrequests']) {
      const exists = await db.listCollections({ name }).hasNext();
      if (exists) {
        await db.collection(name).drop();
        console.log(`Dropped collection ${name}`);
      }
    }
  }

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
