import Banner, { BANNER_PLACEMENTS, BANNER_BACKGROUNDS, BUTTON_STYLES } from '../model/Banner.js';
import SiteSetting from '../model/SiteSetting.js';
import ErrorResponse from '../utils/errorResponse.js';
import { uploadBuffer, deleteResource } from '../utils/cloudinaryHelper.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_PER_PLACEMENT = 10;
const THEME_KEY = 'christmasTheme';

// ─── helpers ────────────────────────────────────────────────────────────────

const toBool = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || v === 'true' || v === '1' || v === 1;
};

const toDate = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '' || v === 'null') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ErrorResponse('Invalid date', 400);
  return d;
};

/** Only allow site paths ("/shop") or http(s) links — never javascript: etc. */
const safeLink = (v, fallback = '') => {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  throw new ErrorResponse(`Invalid link "${s}". Use a site path like /shop or a full https:// address`, 400);
};

const parseButtons = (raw) => {
  if (raw === undefined) return undefined;
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = raw.trim() ? JSON.parse(raw) : [];
    } catch {
      throw new ErrorResponse('Buttons must be valid JSON', 400);
    }
  }
  if (!Array.isArray(list)) throw new ErrorResponse('Buttons must be a list', 400);
  if (list.length > 3) throw new ErrorResponse('A banner can have at most 3 buttons', 400);
  return list
    .filter((b) => b && String(b.label || '').trim())
    .map((b) => ({
      label: String(b.label).trim().slice(0, 40),
      link: safeLink(b.link, '/shop'),
      style: BUTTON_STYLES.includes(b.style) ? b.style : 'primary',
    }));
};

const upload = async (file) => {
  const res = await uploadBuffer(file.buffer, 'banners');
  if (!res?.public_id || !res?.secure_url) throw new ErrorResponse('Image upload failed', 502);
  return { public_id: res.public_id, url: res.secure_url };
};

const buildPayload = (body) => {
  const data = {};
  if (body.placement !== undefined) {
    if (!BANNER_PLACEMENTS.includes(body.placement)) throw new ErrorResponse('Invalid placement', 400);
    data.placement = body.placement;
  }
  if (body.background !== undefined) {
    if (!BANNER_BACKGROUNDS.includes(body.background)) throw new ErrorResponse('Invalid background', 400);
    data.background = body.background;
  }
  if (body.title !== undefined) data.title = String(body.title).trim().slice(0, 120);
  if (body.subtitle !== undefined) data.subtitle = String(body.subtitle).trim().slice(0, 240);
  if (body.link !== undefined) data.link = safeLink(body.link, '');
  if (body.order !== undefined && body.order !== '') data.order = Number(body.order) || 0;

  const buttons = parseButtons(body.buttons);
  if (buttons !== undefined) data.buttons = buttons;

  for (const key of ['christmasFrame', 'showText', 'isActive']) {
    if (body[key] !== undefined) data[key] = toBool(body[key], false);
  }
  const startAt = toDate(body.startAt);
  const endAt = toDate(body.endAt);
  if (startAt !== undefined) data.startAt = startAt;
  if (endAt !== undefined) data.endAt = endAt;
  return data;
};

const checkDates = (startAt, endAt) => {
  if (startAt && endAt && startAt > endAt) throw new ErrorResponse('End date must be after start date', 400);
};

// ─── public ─────────────────────────────────────────────────────────────────

export const getPublicBanners = async (req, res, next) => {
  try {
    const placement = BANNER_PLACEMENTS.includes(req.query.placement) ? req.query.placement : 'hero';
    const now = new Date();
    const banners = await Banner.find({
      placement,
      isActive: true,
      $and: [
        { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt: null }, { endAt: { $gte: now } }] },
      ],
    })
      .select('-updatedBy -image.public_id -mobileImage.public_id')
      .sort({ order: 1, createdAt: 1 })
      .lean();
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, banners });
  } catch (err) {
    return next(err);
  }
};

export const getPublicTheme = async (_req, res, next) => {
  try {
    const setting = await SiteSetting.findOne({ key: THEME_KEY }).lean();
    // null = never set by an admin -> the website falls back to the Christmas date window
    return res.json({ success: true, christmas: setting ? setting.booleanValue === true : null });
  } catch (err) {
    return next(err);
  }
};

// ─── admin ──────────────────────────────────────────────────────────────────

export const getAdminBanners = async (req, res, next) => {
  try {
    const filter = BANNER_PLACEMENTS.includes(req.query.placement) ? { placement: req.query.placement } : {};
    const banners = await Banner.find(filter)
      .populate('updatedBy', 'name')
      .sort({ placement: 1, order: 1, createdAt: 1 })
      .lean();
    const setting = await SiteSetting.findOne({ key: THEME_KEY }).lean();
    return res.json({
      success: true,
      banners,
      christmas: setting ? setting.booleanValue === true : null,
    });
  } catch (err) {
    return next(err);
  }
};

export const createBanner = async (req, res, next) => {
  try {
    const data = buildPayload(req.body);
    data.placement = data.placement || 'hero';
    checkDates(data.startAt, data.endAt);

    const count = await Banner.countDocuments({ placement: data.placement });
    if (count >= MAX_PER_PLACEMENT) {
      return next(new ErrorResponse(`Maximum ${MAX_PER_PLACEMENT} banners allowed in this section`, 400));
    }

    const image = req.files?.image?.[0];
    const mobileImage = req.files?.mobileImage?.[0];
    if ((data.background || 'image') === 'image' && !image) {
      return next(new ErrorResponse('Please upload a banner image (or choose the Christmas background)', 400));
    }
    if (data.order === undefined) data.order = count;
    if (image) data.image = await upload(image);
    if (mobileImage) data.mobileImage = await upload(mobileImage);
    data.updatedBy = req.user?._id || null;

    const banner = await Banner.create(data);
    return res.status(201).json({ success: true, banner, message: 'Banner created' });
  } catch (err) {
    return next(err);
  }
};

export const updateBanner = async (req, res, next) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) return next(new ErrorResponse('Invalid banner ID', 400));
    const banner = await Banner.findById(req.params.id);
    if (!banner) return next(new ErrorResponse('Banner not found', 404));

    const data = buildPayload(req.body);
    checkDates(
      data.startAt !== undefined ? data.startAt : banner.startAt,
      data.endAt !== undefined ? data.endAt : banner.endAt,
    );

    const oldIds = [];
    const image = req.files?.image?.[0];
    const mobileImage = req.files?.mobileImage?.[0];
    if (image) {
      oldIds.push(banner.image?.public_id);
      data.image = await upload(image);
    } else if (toBool(req.body.removeImage, false)) {
      oldIds.push(banner.image?.public_id);
      data.image = { public_id: '', url: '' };
    }
    if (mobileImage) {
      oldIds.push(banner.mobileImage?.public_id);
      data.mobileImage = await upload(mobileImage);
    } else if (toBool(req.body.removeMobileImage, false)) {
      oldIds.push(banner.mobileImage?.public_id);
      data.mobileImage = { public_id: '', url: '' };
    }

    const nextBackground = data.background || banner.background;
    const nextImageUrl = data.image ? data.image.url : banner.image?.url;
    if (nextBackground === 'image' && !nextImageUrl) {
      return next(new ErrorResponse('An image banner needs an image (or choose the Christmas background)', 400));
    }

    Object.assign(banner, data, { updatedBy: req.user?._id || null });
    await banner.save();
    await Promise.all(oldIds.filter(Boolean).map((id) => deleteResource(id).catch(() => {})));

    return res.json({ success: true, banner, message: 'Banner updated' });
  } catch (err) {
    return next(err);
  }
};

export const deleteBanner = async (req, res, next) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) return next(new ErrorResponse('Invalid banner ID', 400));
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) return next(new ErrorResponse('Banner not found', 404));
    await Promise.all(
      [banner.image?.public_id, banner.mobileImage?.public_id]
        .filter(Boolean)
        .map((id) => deleteResource(id).catch(() => {})),
    );
    return res.json({ success: true, message: 'Banner deleted' });
  } catch (err) {
    return next(err);
  }
};

export const reorderBanners = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length || ids.some((id) => !OBJECT_ID_RE.test(String(id)))) {
      return next(new ErrorResponse('ids must be a list of banner IDs', 400));
    }
    await Banner.bulkWrite(
      ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: index } } } })),
    );
    return res.json({ success: true, message: 'Order saved' });
  } catch (err) {
    return next(err);
  }
};

export const updateTheme = async (req, res, next) => {
  try {
    const christmas = toBool(req.body.christmas, false);
    await SiteSetting.findOneAndUpdate(
      { key: THEME_KEY },
      { $set: { booleanValue: christmas } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    return res.json({
      success: true,
      christmas,
      message: christmas ? 'Christmas decorations turned on' : 'Christmas decorations turned off',
    });
  } catch (err) {
    return next(err);
  }
};
