// DEMO DATA. Every restaurant, dish, price, rating and delivery time in this
// file is invented for the prototype. Nothing here comes from Swiggy.
// Amounts are integer paise.

export const DEMO_LABEL = "Demo data";

export const session = {
  code: "DEMO-4821",
  name: "Friday hostel dinner",
  place: "Block C common room",
  budgetPaise: 140000,
  // Sample tax rate applied to the food subtotal. Real taxes come from the platform later.
  taxPercent: 5,
};

export const members = [
  { id: "aarav", name: "Aarav", diet: "nonveg", limitPaise: 32000, cuisines: ["Biryani", "Chinese"], color: "indigo" },
  { id: "meera", name: "Meera", diet: "veg", limitPaise: 28000, cuisines: ["South Indian", "Chinese"], color: "turmeric" },
  { id: "karthik", name: "Karthik", diet: "nonveg", limitPaise: 30000, cuisines: ["Biryani", "North Indian"], color: "beetroot" },
  { id: "sana", name: "Sana", diet: "veg", limitPaise: 26000, cuisines: ["South Indian", "North Indian"], color: "teal" },
  { id: "rohan", name: "Rohan", diet: "nonveg", limitPaise: 30000, cuisines: ["Chinese", "Biryani"], color: "tamarind" },
];

export const cuisines = ["Biryani", "South Indian", "North Indian", "Chinese"];

export const mealPairings = {
  "masala-dosa": ["dosa-chutney"],
  "chicken-biryani": ["raita"],
  "paneer-biryani": ["raita"],
  "butter-chicken": ["butter-naan"],
  "paneer-butter-masala": ["butter-naan"],
  "chicken-fried-rice": ["gobi-manchurian"],
  "veg-hakka-noodles": ["gobi-manchurian"],
};


// kind: "main" dishes are what the diet check counts. "side" and "drink" are extras.
export const restaurants = [
  {
    id: "biryani-house",
    name: "Demo Biryani House",
    cuisine: "Biryani",
    rating: 4.3,
    etaMinutes: [35, 40],
    deliveryFeePaise: 3900,
    packagingFeePaise: 2500,
    items: [
      { id: "chicken-biryani", name: "Chicken dum biryani", pricePaise: 22900, diet: "nonveg", kind: "main" },
      { id: "paneer-biryani", name: "Paneer tikka biryani", pricePaise: 19900, diet: "veg", kind: "main" },
      { id: "raita", name: "Boondi raita", pricePaise: 3900, diet: "veg", kind: "side" },
    ],
    combo: [
      { itemId: "chicken-biryani", qty: 3 },
      { itemId: "paneer-biryani", qty: 2 },
      { itemId: "raita", qty: 2 },
    ],
  },
  {
    id: "dosa-corner",
    name: "Demo Dosa Corner",
    cuisine: "South Indian",
    rating: 4.5,
    etaMinutes: [25, 30],
    deliveryFeePaise: 3000,
    packagingFeePaise: 2000,
    
items: [
  { id: "masala-dosa", name: "Masala dosa", pricePaise: 9900, diet: "veg", kind: "main" },
  { id: "dosa-chutney", name: "Dosa chutney", pricePaise: 1000, diet: "veg", kind: "side" },
  { id: "sambar", name: "Sambar", pricePaise: 1500, diet: "veg", kind: "side" },
  { id: "medu-vada", name: "Medu vada (2 pcs)", pricePaise: 7900, diet: "veg", kind: "side" },
  { id: "filter-coffee", name: "Filter coffee", pricePaise: 3900, diet: "veg", kind: "drink" },
],

    combo: [
      { itemId: "masala-dosa", qty: 5 },
      { itemId: "medu-vada", qty: 2 },
      { itemId: "filter-coffee", qty: 5 },
    ],
  },
  {
    id: "tandoor-tales",
    name: "Demo Tandoor Tales",
    cuisine: "North Indian",
    rating: 4.1,
    etaMinutes: [40, 45],
    deliveryFeePaise: 4900,
    packagingFeePaise: 3000,
    items: [
      { id: "butter-chicken", name: "Butter chicken", pricePaise: 27900, diet: "nonveg", kind: "main" },
      { id: "paneer-butter-masala", name: "Paneer butter masala", pricePaise: 21900, diet: "veg", kind: "main" },
      { id: "butter-naan", name: "Butter naan", pricePaise: 3900, diet: "veg", kind: "side" },
    ],
    combo: [
      { itemId: "butter-chicken", qty: 3 },
      { itemId: "paneer-butter-masala", qty: 2 },
      { itemId: "butter-naan", qty: 8 },
    ],
  },
  {
    id: "wok-street",
    name: "Demo Wok Street",
    cuisine: "Chinese",
    rating: 4.0,
    etaMinutes: [30, 35],
    deliveryFeePaise: 4500,
    packagingFeePaise: 2000,
    items: [
      { id: "chicken-fried-rice", name: "Chicken fried rice", pricePaise: 16900, diet: "nonveg", kind: "main" },
      { id: "veg-hakka-noodles", name: "Veg hakka noodles", pricePaise: 14900, diet: "veg", kind: "main" },
      { id: "gobi-manchurian", name: "Gobi manchurian", pricePaise: 13900, diet: "veg", kind: "side" },
    ],
    combo: [
      { itemId: "chicken-fried-rice", qty: 3 },
      { itemId: "veg-hakka-noodles", qty: 2 },
      { itemId: "gobi-manchurian", qty: 2 },
    ],
  },
];
