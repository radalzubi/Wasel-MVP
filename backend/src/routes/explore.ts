import { Router, Request, Response } from 'express';

const router = Router();

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

type PlaceCategory = 'restaurant' | 'cafe' | 'landmark' | 'shopping';

interface Place {
  id:             string;
  name:           string;
  name_ar:        string;
  category:       PlaceCategory;
  description:    string;
  description_ar: string;
  address:        string;
  address_ar:     string;
  lat:            number;
  lng:            number;
  rating:         number;
  price_range:    string;
  image_emoji:    string;
}

// ----------------------------------------------------------------
// Google Places helpers
// ----------------------------------------------------------------

// Amman city centre — used as the search origin for Google Places.
const AMMAN_LAT = 31.9539;
const AMMAN_LNG = 35.9106;
const SEARCH_RADIUS_M = 8_000; // 8 km covers central Amman

// Simple in-memory cache so we don't burn API quota on every request.
let googlePlacesCache: Place[] | null = null;
let googleCacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

const PRICE_RANGE: Record<number, string> = { 0: 'Free', 1: '$', 2: '$$', 3: '$$$', 4: '$$$$' };

// Google Places type → our category + emoji
const TYPE_META: { types: string[]; category: PlaceCategory; emoji: string }[] = [
  { types: ['restaurant'],         category: 'restaurant', emoji: '🍽️' },
  { types: ['cafe'],               category: 'cafe',       emoji: '☕' },
  { types: ['tourist_attraction'], category: 'landmark',   emoji: '🏛️' },
  { types: ['shopping_mall'],      category: 'shopping',   emoji: '🛍️' },
];

function googleTypeToCategory(types: string[]): PlaceCategory {
  if (types.includes('restaurant') || types.includes('food')) return 'restaurant';
  if (types.includes('cafe'))                                  return 'cafe';
  if (types.includes('shopping_mall') || types.includes('store')) return 'shopping';
  return 'landmark';
}

function googleTypeToEmoji(types: string[]): string {
  if (types.includes('restaurant') || types.includes('food')) return '🍽️';
  if (types.includes('cafe'))                                  return '☕';
  if (types.includes('shopping_mall'))                         return '🛍️';
  return '📍';
}

// Fetch one "page" of nearby results for a given Google Places type.
async function fetchNearbyPage(type: string, key: string): Promise<Place[]> {
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${AMMAN_LAT},${AMMAN_LNG}` +
    `&radius=${SEARCH_RADIUS_M}` +
    `&type=${type}` +
    `&key=${key}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return [];

  const json = await res.json() as any;
  if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
    console.warn(`[explore] Google Places ${type} returned status=${json.status}`);
    return [];
  }

  return ((json.results ?? []) as any[]).slice(0, 8).map((p): Place => ({
    id:             p.place_id,
    name:           p.name,
    name_ar:        p.name,          // Arabic localisation requires a separate API call; use English as fallback
    category:       googleTypeToCategory(p.types ?? []),
    description:    p.vicinity ?? '',
    description_ar: p.vicinity ?? '',
    address:        p.vicinity ?? '',
    address_ar:     p.vicinity ?? '',
    lat:            p.geometry?.location?.lat ?? AMMAN_LAT,
    lng:            p.geometry?.location?.lng ?? AMMAN_LNG,
    rating:         p.rating ?? 0,
    price_range:    PRICE_RANGE[p.price_level as number] ?? '$$',
    image_emoji:    googleTypeToEmoji(p.types ?? []),
  }));
}

// Fetch all categories from Google Places and merge, deduplicate by place_id.
async function fetchGooglePlaces(): Promise<Place[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];

  const now = Date.now();
  if (googlePlacesCache && now < googleCacheExpiresAt) return googlePlacesCache;

  try {
    const results = await Promise.allSettled(
      TYPE_META.map((m) => fetchNearbyPage(m.types[0], key)),
    );

    const seen  = new Set<string>();
    const places: Place[] = [];

    for (const r of results) {
      if (r.status === 'rejected') continue;
      for (const p of r.value) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          places.push(p);
        }
      }
    }

    if (places.length > 0) {
      googlePlacesCache    = places;
      googleCacheExpiresAt = now + CACHE_TTL_MS;
      return places;
    }
  } catch (err) {
    console.warn('[explore] Google Places fetch failed, using static data:', err);
  }

  return [];
}

// ----------------------------------------------------------------
// Hardcoded Amman places — MVP fallback when Google Places key is
// absent or the API is temporarily unavailable.
// ----------------------------------------------------------------

const STATIC_PLACES: Place[] = [
  // Restaurants
  {
    id:             'hashem',
    name:           'Hashem Restaurant',
    name_ar:        'مطعم هاشم',
    category:       'restaurant',
    description:    'An Amman institution since 1952, famous for falafel, hummus, and ful. Open 24 hours.',
    description_ar: 'مؤسسة عمّانية منذ عام 1952، شهيرة بالفلافل والحمص والفول. مفتوح على مدار الساعة.',
    address:        'Downtown Amman, Al-Hashemi Street',
    address_ar:     'وسط البلد، شارع الهاشمي',
    lat:            31.9520,
    lng:            35.9326,
    rating:         4.8,
    price_range:    '$',
    image_emoji:    '🧆',
  },
  {
    id:             'sufra',
    name:           'Sufra Restaurant',
    name_ar:        'مطعم سفرة',
    category:       'restaurant',
    description:    'Traditional Jordanian home cooking in a beautifully restored Ottoman-era house on Rainbow Street.',
    description_ar: 'مطبخ أردني منزلي تقليدي في منزل عثماني مرمّم بشكل جميل على شارع الرينبو.',
    address:        '26 Rainbow Street, Jabal Amman',
    address_ar:     'شارع الرينبو 26، جبل عمّان',
    lat:            31.9553,
    lng:            35.9227,
    rating:         4.6,
    price_range:    '$$',
    image_emoji:    '🍽️',
  },
  {
    id:             'fakhr-el-din',
    name:           'Fakhr El-Din',
    name_ar:        'فخر الدين',
    category:       'restaurant',
    description:    'Upscale Lebanese and Jordanian cuisine served in a 1920s mansion, known for mezze and grills.',
    description_ar: 'مطبخ لبناني وأردني راقٍ في قصر يعود إلى عشرينيات القرن الماضي، معروف بالمقبلات والمشويات.',
    address:        '40 Taha Hussein Street, Jabal Amman',
    address_ar:     'شارع طه حسين 40، جبل عمّان',
    lat:            31.9540,
    lng:            35.9183,
    rating:         4.7,
    price_range:    '$$$',
    image_emoji:    '🥘',
  },
  {
    id:             'tawaheen-al-hawa',
    name:           'Tawaheen Al Hawa',
    name_ar:        'طواحين الهواء',
    category:       'restaurant',
    description:    'Scenic hillside restaurant with panoramic views of Amman, serving Jordanian and Arabic food.',
    description_ar: 'مطعم على التل مع إطلالة بانورامية على عمّان، يقدم الطعام الأردني والعربي.',
    address:        'Um Al Summaq, West Amman',
    address_ar:     'أم السماق، غرب عمّان',
    lat:            31.9761,
    lng:            35.8733,
    rating:         4.5,
    price_range:    '$$',
    image_emoji:    '🌄',
  },
  {
    id:             'reem-al-bawadi',
    name:           "Reem Al Bawadi",
    name_ar:        'ريم البوادي',
    category:       'restaurant',
    description:    'Famous for traditional mansaf and Bedouin-style grills in a large, lively setting.',
    description_ar: 'شهير بالمنسف التقليدي والمشاوي على الطريقة البدوية في أجواء واسعة وحيوية.',
    address:        '7th Circle, Amman',
    address_ar:     'الدوار السابع، عمّان',
    lat:            31.9655,
    lng:            35.8608,
    rating:         4.4,
    price_range:    '$$',
    image_emoji:    '🫕',
  },

  // Cafes
  {
    id:             'books-at-cafe',
    name:           'Books@cafe',
    name_ar:        'بوكس آت كافيه',
    category:       'cafe',
    description:    'A beloved Amman café with a bookshop, rooftop terrace, and eclectic menu. A Rainbow Street landmark.',
    description_ar: 'مقهى عمّاني محبوب مع مكتبة وتراس علوي وقائمة متنوعة. معلم شهير على شارع الرينبو.',
    address:        'Omar Bin Al-Khattab Street, Rainbow Street, Jabal Amman',
    address_ar:     'شارع عمر بن الخطاب، شارع الرينبو، جبل عمّان',
    lat:            31.9547,
    lng:            35.9210,
    rating:         4.5,
    price_range:    '$$',
    image_emoji:    '📚',
  },
  {
    id:             'wild-jordan',
    name:           'Wild Jordan Café',
    name_ar:        'وايلد جوردان كافيه',
    category:       'cafe',
    description:    'Eco-friendly café run by the Royal Society for the Conservation of Nature with stunning city views.',
    description_ar: 'مقهى صديق للبيئة تديره الجمعية الملكية لحماية الطبيعة مع إطلالات رائعة على المدينة.',
    address:        'Othman Bin Affan Street, Downtown Amman',
    address_ar:     'شارع عثمان بن عفان، وسط البلد',
    lat:            31.9525,
    lng:            35.9305,
    rating:         4.6,
    price_range:    '$$',
    image_emoji:    '🌿',
  },
  {
    id:             'shams-el-balad',
    name:           'Shams El Balad',
    name_ar:        'شمس البلد',
    category:       'cafe',
    description:    'Cozy organic café in a 1940s house, serving farm-to-table breakfasts and specialty coffee.',
    description_ar: 'مقهى عضوي دافئ في منزل من الأربعينيات، يقدم وجبات إفطار من المزرعة إلى المائدة وقهوة متخصصة.',
    address:        'Aqaba Street, Jabal Amman',
    address_ar:     'شارع العقبة، جبل عمّان',
    lat:            31.9562,
    lng:            35.9198,
    rating:         4.7,
    price_range:    '$$',
    image_emoji:    '☀️',
  },
  {
    id:             'rumi-cafe',
    name:           'Rumi Café',
    name_ar:        'مقهى رومي',
    category:       'cafe',
    description:    'Artistic café in Jabal Lweibdeh with a gallery space, specialty brews, and live music nights.',
    description_ar: 'مقهى فني في جبل اللويبدة مع قاعة عرض وقهوة متخصصة وليالٍ موسيقية حية.',
    address:        'Mango Street, Jabal Lweibdeh',
    address_ar:     'شارع المانجو، جبل اللويبدة',
    lat:            31.9594,
    lng:            35.9255,
    rating:         4.4,
    price_range:    '$',
    image_emoji:    '🎶',
  },

  // Landmarks
  {
    id:             'roman-amphitheatre',
    name:           'Roman Amphitheatre',
    name_ar:        'المدرج الروماني',
    category:       'landmark',
    description:    '2nd-century Roman theatre carved into a hillside seating 6,000. One of the best-preserved in the world.',
    description_ar: 'مسرح روماني من القرن الثاني منحوت في التل يتسع لـ6000 شخص، من أفضل المحافظ عليها في العالم.',
    address:        'Hashemi Street, Downtown Amman',
    address_ar:     'شارع الهاشمي، وسط البلد',
    lat:            31.9518,
    lng:            35.9353,
    rating:         4.8,
    price_range:    '$',
    image_emoji:    '🏛️',
  },
  {
    id:             'citadel',
    name:           'Amman Citadel (Jabal Al-Qala\'a)',
    name_ar:        'قلعة عمّان (جبل القلعة)',
    category:       'landmark',
    description:    'Ancient hilltop site with ruins spanning thousands of years including the Temple of Hercules.',
    description_ar: 'موقع تلة قديم بأطلال تمتد لآلاف السنين بما فيها معبد هرقل.',
    address:        'Jabal Al-Qala\'a, Downtown Amman',
    address_ar:     'جبل القلعة، وسط البلد',
    lat:            31.9550,
    lng:            35.9356,
    rating:         4.7,
    price_range:    '$',
    image_emoji:    '🏰',
  },
  {
    id:             'rainbow-street',
    name:           'Rainbow Street',
    name_ar:        'شارع الرينبو',
    category:       'landmark',
    description:    'Amman\'s most vibrant street lined with cafés, galleries, street art, and stunning valley views.',
    description_ar: 'أكثر شوارع عمّان حيوية، مليء بالمقاهي والمعارض والفن الجداري وإطلالات رائعة على الوادي.',
    address:        'Omar Bin Al-Khattab Street, 1st Circle, Jabal Amman',
    address_ar:     'شارع عمر بن الخطاب، الدوار الأول، جبل عمّان',
    lat:            31.9549,
    lng:            35.9209,
    rating:         4.9,
    price_range:    'Free',
    image_emoji:    '🌈',
  },
  {
    id:             'king-hussein-park',
    name:           'King Hussein Park',
    name_ar:        'حديقة الملك حسين',
    category:       'landmark',
    description:    'The largest urban park in Amman, ideal for walks, cycling, and family outings.',
    description_ar: 'أكبر حديقة حضرية في عمّان، مثالية للمشي وركوب الدراجات ونزهات العائلة.',
    address:        '4th Circle, Amman',
    address_ar:     'الدوار الرابع، عمّان',
    lat:            31.9721,
    lng:            35.8891,
    rating:         4.4,
    price_range:    'Free',
    image_emoji:    '🌳',
  },

  // Shopping
  {
    id:             'abdali-mall',
    name:           'Abdali Mall',
    name_ar:        'مول عبدلي',
    category:       'shopping',
    description:    'Modern open-air mall in the heart of the Abdali Boulevard with international and local brands.',
    description_ar: 'مول عصري في الهواء الطلق في قلب بوليفار عبدلي مع ماركات دولية ومحلية.',
    address:        'Abdali Boulevard, Al-Abdali',
    address_ar:     'بوليفار عبدلي، العبدلي',
    lat:            31.9702,
    lng:            35.9175,
    rating:         4.5,
    price_range:    '$$',
    image_emoji:    '🛍️',
  },
  {
    id:             'city-mall',
    name:           'City Mall',
    name_ar:        'سيتي مول',
    category:       'shopping',
    description:    'One of Amman\'s largest malls with over 250 stores, cinema, and dining options.',
    description_ar: 'أحد أكبر مولات عمّان بأكثر من 250 متجراً وسينما وخيارات طعام متنوعة.',
    address:        'Dawwar Khalda, Khalda',
    address_ar:     'دوار خلدا، خلدا',
    lat:            31.9801,
    lng:            35.8650,
    rating:         4.4,
    price_range:    '$$',
    image_emoji:    '🏬',
  },
  {
    id:             'souk-jara',
    name:           'Souk Jara',
    name_ar:        'سوق جارا',
    category:       'shopping',
    description:    'Seasonal Friday open-air market on Rainbow Street featuring local artisans, food, and crafts.',
    description_ar: 'سوق موسمي في الهواء الطلق يُقام يوم الجمعة على شارع الرينبو مع حرفيين محليين وأكل وحرف يدوية.',
    address:        'Rainbow Street, Jabal Amman (Fridays only, Apr–Oct)',
    address_ar:     'شارع الرينبو، جبل عمّان (أيام الجمعة فقط، أبريل–أكتوبر)',
    lat:            31.9548,
    lng:            35.9210,
    rating:         4.7,
    price_range:    '$',
    image_emoji:    '🎨',
  },
];

// ----------------------------------------------------------------
// GET /api/explore
//
// Returns Google Places Nearby results for central Amman when
// GOOGLE_PLACES_API_KEY is configured, otherwise falls back to the
// curated static list above.  Results are cached for 1 hour.
//
// Rate-limiting note: the global 100 req/min limit applied in
// index.ts is sufficient for the MVP.  If this becomes a hot
// endpoint, add a dedicated 30 req/min limiter here.
// ----------------------------------------------------------------

router.get('/', async (req: Request, res: Response) => {
  const { category } = req.query;

  // Validate category filter if provided
  if (category !== undefined) {
    const validCategories: PlaceCategory[] = ['restaurant', 'cafe', 'landmark', 'shopping'];
    if (!validCategories.includes(category as PlaceCategory)) {
      return res.status(400).json({
        error:    'Invalid category',
        valid:    validCategories,
        received: category,
      });
    }
  }

  // Try Google Places first; fall through to static data on failure / missing key
  let places = await fetchGooglePlaces();
  if (places.length === 0) places = STATIC_PLACES;

  const filtered = category
    ? places.filter((p) => p.category === category)
    : places;

  res.json(filtered);
});

export default router;
