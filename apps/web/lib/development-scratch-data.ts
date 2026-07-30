import type { CacheMapPoint } from "../components/cache-map";
import type { ScratchCountryBucket, ScratchMapData } from "../components/scratch-map";

type DevelopmentCountry = {
  name: string;
  continent: string;
  points: Array<{
    name: string;
    latitude: number;
    longitude: number;
  }>;
};

const developmentCountries: DevelopmentCountry[] = [
  {
    name: "United States",
    continent: "North America",
    points: [
      { name: "Golden Gate View", latitude: 37.8199, longitude: -122.4783 },
      { name: "Seattle Needle Hunt", latitude: 47.6205, longitude: -122.3493 },
      { name: "Central Park Ramble", latitude: 40.7812, longitude: -73.9665 },
      { name: "Austin Greenbelt", latitude: 30.264, longitude: -97.771 },
      { name: "Rocky Mountain Trail", latitude: 40.3428, longitude: -105.6836 },
      { name: "Florida Keys Hide", latitude: 24.5551, longitude: -81.78 }
    ]
  },
  {
    name: "Sweden",
    continent: "Europe",
    points: [
      { name: "Blekinge Trail", latitude: 56.1612, longitude: 15.5869 },
      { name: "Stockholm Old Town", latitude: 59.3251, longitude: 18.0711 },
      { name: "Gothenburg Harbour", latitude: 57.7089, longitude: 11.9746 },
      { name: "Malmö Turning Torso", latitude: 55.6135, longitude: 12.9764 },
      { name: "Kiruna Midnight Sun", latitude: 67.8558, longitude: 20.2253 }
    ]
  },
  {
    name: "Norway",
    continent: "Europe",
    points: [
      { name: "Oslo Fjord", latitude: 59.9139, longitude: 10.7522 },
      { name: "Bergen Bryggen", latitude: 60.3971, longitude: 5.3244 },
      { name: "Trondheim Trail", latitude: 63.4305, longitude: 10.3951 },
      { name: "Tromsø Aurora", latitude: 69.6492, longitude: 18.9553 }
    ]
  },
  {
    name: "Canada",
    continent: "North America",
    points: [
      { name: "Stanley Park Cedar", latitude: 49.3043, longitude: -123.1443 },
      { name: "Calgary Bow River", latitude: 51.0447, longitude: -114.0719 },
      { name: "Toronto Island", latitude: 43.6214, longitude: -79.3789 },
      { name: "Montréal Mountain", latitude: 45.5048, longitude: -73.5878 }
    ]
  },
  {
    name: "Japan",
    continent: "Asia",
    points: [
      { name: "Tokyo Lantern", latitude: 35.6762, longitude: 139.6503 },
      { name: "Kyoto Temple Path", latitude: 35.0116, longitude: 135.7681 },
      { name: "Osaka Castle", latitude: 34.6873, longitude: 135.5262 },
      { name: "Sapporo Snow Cache", latitude: 43.0618, longitude: 141.3545 }
    ]
  },
  {
    name: "Australia",
    continent: "Oceania",
    points: [
      { name: "Sydney Harbour", latitude: -33.8523, longitude: 151.2108 },
      { name: "Melbourne Laneway", latitude: -37.8136, longitude: 144.9631 },
      { name: "Brisbane Riverwalk", latitude: -27.4698, longitude: 153.0251 },
      { name: "Perth Kings Park", latitude: -31.9617, longitude: 115.8323 }
    ]
  },
  {
    name: "Iceland",
    continent: "Europe",
    points: [
      { name: "Reykjavík Rainbow", latitude: 64.1466, longitude: -21.9426 },
      { name: "Golden Circle", latitude: 64.2559, longitude: -20.4047 },
      { name: "Vík Black Sand", latitude: 63.4186, longitude: -19.006 }
    ]
  },
  {
    name: "Portugal",
    continent: "Europe",
    points: [
      { name: "Lisbon Tram", latitude: 38.7223, longitude: -9.1393 },
      { name: "Porto Riverside", latitude: 41.1579, longitude: -8.6291 },
      { name: "Faro Old Town", latitude: 37.0194, longitude: -7.9304 }
    ]
  },
  {
    name: "Brazil",
    continent: "South America",
    points: [
      { name: "Rio Lookout", latitude: -22.9519, longitude: -43.2105 },
      { name: "São Paulo Park", latitude: -23.5874, longitude: -46.6576 },
      { name: "Salvador Seafront", latitude: -12.9714, longitude: -38.5014 }
    ]
  },
  {
    name: "South Africa",
    continent: "Africa",
    points: [
      { name: "Table Mountain", latitude: -33.9628, longitude: 18.4098 },
      { name: "Johannesburg Ridge", latitude: -26.2041, longitude: 28.0473 },
      { name: "Durban Promenade", latitude: -29.8587, longitude: 31.0218 }
    ]
  },
  {
    name: "India",
    continent: "Asia",
    points: [
      { name: "Delhi Garden", latitude: 28.5933, longitude: 77.2507 },
      { name: "Mumbai Seaface", latitude: 18.944, longitude: 72.823 },
      { name: "Bengaluru Lake", latitude: 12.9763, longitude: 77.5929 }
    ]
  },
  {
    name: "Mexico",
    continent: "North America",
    points: [
      { name: "Chapultepec Woods", latitude: 19.4204, longitude: -99.1819 },
      { name: "Mérida Plaza", latitude: 20.9674, longitude: -89.5926 }
    ]
  },
  {
    name: "Kenya",
    continent: "Africa",
    points: [
      { name: "Nairobi Arboretum", latitude: -1.2775, longitude: 36.8028 },
      { name: "Mombasa Fort", latitude: -4.0622, longitude: 39.6792 }
    ]
  },
  {
    name: "New Zealand",
    continent: "Oceania",
    points: [
      { name: "Auckland Volcano", latitude: -36.8778, longitude: 174.7645 },
      { name: "Wellington Waterfront", latitude: -41.2905, longitude: 174.7821 }
    ]
  }
];

export const developmentScratchMapPoints: CacheMapPoint[] = developmentCountries.flatMap((country, countryIndex) =>
  country.points.map((point, pointIndex) => ({
    id: `development-cache-${countryIndex + 1}-${pointIndex + 1}`,
    gcCode: `GCDEV${String(countryIndex + 1).padStart(2, "0")}${String(pointIndex + 1).padStart(2, "0")}`,
    name: point.name,
    cacheType: pointIndex % 3 === 1 ? "Multi-cache" : pointIndex % 3 === 2 ? "Mystery Cache" : "Traditional Cache",
    latitude: point.latitude,
    longitude: point.longitude,
    foundAt: new Date(Date.UTC(2026, 6, 1 + countryIndex * 2 + pointIndex)).toISOString()
  }))
);

const countries: ScratchCountryBucket[] = developmentCountries
  .map((country) => ({
    name: country.name,
    continent: country.continent,
    count: country.points.length,
    regions: [],
    counties: []
  }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const continentCounts = new Map<string, number>();
countries.forEach((country) => {
  continentCounts.set(country.continent, (continentCounts.get(country.continent) ?? 0) + country.count);
});

export const developmentScratchMapData: ScratchMapData = {
  totalFinds: developmentScratchMapPoints.length,
  truncated: false,
  limit: 5000,
  continents: [...continentCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  countries,
  maxCountryCount: Math.max(...countries.map((country) => country.count))
};
