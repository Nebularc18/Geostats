"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { CacheMapPoint } from "../../components/cache-map";
import {
  ScratchCountryBucket,
  ScratchLocationBucket,
  ScratchMap,
  ScratchMapData,
  ScratchMapLevel,
  ScratchMapView,
  ICELAND_COUNTY_GEOJSON_URL,
  ICELAND_REGION_GEOJSON_URL,
  SWEDEN_COUNTY_GEOJSON_URL,
  scratchColor
} from "../../components/scratch-map";
import { apiFetch } from "../../lib/api";
import { deriveBucketsFromBoundaries } from "../../lib/scratch-boundaries";

const ALL_CONTINENTS = "All continents";
const WORLD_VIEW = "world";
const MAP_LEVELS: { value: ScratchMapLevel; label: string }[] = [
  { value: "countries", label: "Countries" },
  { value: "regions", label: "Regions" },
  { value: "counties", label: "Counties" }
];

function findPercent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function LocationTile({
  bucket,
  max,
  total
}: {
  bucket: ScratchLocationBucket;
  max: number;
  total: number;
}) {
  return (
    <div className="scratch-tile" style={{ "--scratch-color": scratchColor(bucket.count, max) } as React.CSSProperties}>
      <strong>{bucket.name}</strong>
      <span>
        {bucket.count} finds - {findPercent(bucket.count, total)}%
      </span>
    </div>
  );
}

export default function ScratchPage() {
  const [scratch, setScratch] = useState<ScratchMapData | null>(null);
  const [points, setPoints] = useState<CacheMapPoint[]>([]);
  const [swedenCountyBuckets, setSwedenCountyBuckets] = useState<ScratchLocationBucket[]>([]);
  const [icelandRegionBuckets, setIcelandRegionBuckets] = useState<ScratchLocationBucket[]>([]);
  const [icelandCountyBuckets, setIcelandCountyBuckets] = useState<ScratchLocationBucket[]>([]);
  const [activeContinent, setActiveContinent] = useState(ALL_CONTINENTS);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [mapLevel, setMapLevel] = useState<ScratchMapLevel>("countries");
  const [mapView, setMapView] = useState<ScratchMapView | null>(WORLD_VIEW);
  const [mapViewFocusVersion, setMapViewFocusVersion] = useState(0);
  const [countryFocusVersion, setCountryFocusVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<ScratchMapData>("/map/scratch")
      .then((data) => {
        setScratch(data);
        setSelectedCountry(data.countries[0]?.name ?? null);
      })
      .catch(() => setError("Could not load scratch map coverage."));
    void apiFetch<{ points: CacheMapPoint[] }>("/map/caches")
      .then((data) => setPoints(data.points))
      .catch(() => setError("Could not load scratch map points."));
  }, []);

  useEffect(() => {
    if (points.length === 0) {
      setSwedenCountyBuckets([]);
      setIcelandRegionBuckets([]);
      setIcelandCountyBuckets([]);
      return;
    }

    let cancelled = false;
    void Promise.allSettled([
      deriveBucketsFromBoundaries(points, SWEDEN_COUNTY_GEOJSON_URL, "kom_namn"),
      deriveBucketsFromBoundaries(points, ICELAND_REGION_GEOJSON_URL, "shapeName"),
      deriveBucketsFromBoundaries(points, ICELAND_COUNTY_GEOJSON_URL, "shapeName")
    ]).then(([swedenCounties, icelandRegions, icelandCounties]) => {
      if (cancelled) {
        return;
      }

      setSwedenCountyBuckets(swedenCounties.status === "fulfilled" ? swedenCounties.value : []);
      setIcelandRegionBuckets(icelandRegions.status === "fulfilled" ? icelandRegions.value : []);
      setIcelandCountyBuckets(icelandCounties.status === "fulfilled" ? icelandCounties.value : []);
    });

    return () => {
      cancelled = true;
    };
  }, [points]);

  const continents = useMemo(
    () => [ALL_CONTINENTS, ...(scratch?.continents.map((continent) => continent.name) ?? [])],
    [scratch]
  );
  const mapViewOptions = useMemo(
    () => [
      { value: WORLD_VIEW, label: "World" },
      ...(scratch?.continents.map((continent) => ({
        value: continent.name as ScratchMapView,
        label: continent.name
      })) ?? [])
    ],
    [scratch]
  );

  const visibleCountries = useMemo(() => {
    const countries = scratch?.countries ?? [];
    return activeContinent === ALL_CONTINENTS
      ? countries
      : countries.filter((country) => country.continent === activeContinent);
  }, [activeContinent, scratch]);

  const activeCountry = useMemo<ScratchCountryBucket | null>(() => {
    if (!scratch) {
      return null;
    }

    const country = visibleCountries.find((candidate) => candidate.name === selectedCountry) ?? visibleCountries[0] ?? null;
    if (country?.name === "Sweden") {
      return {
        ...country,
        counties: swedenCountyBuckets
      };
    }

    if (country?.name === "Iceland") {
      return {
        ...country,
        regions: icelandRegionBuckets,
        counties: icelandCountyBuckets
      };
    }

    return country;
  }, [icelandCountyBuckets, icelandRegionBuckets, scratch, selectedCountry, swedenCountyBuckets, visibleCountries]);

  const selectCountry = useCallback((country: string) => {
    setSelectedCountry(country);
    setCountryFocusVersion((version) => version + 1);
  }, []);

  const selectContinent = useCallback((continent: string) => {
    setActiveContinent(continent);
    setMapView(continent === ALL_CONTINENTS ? WORLD_VIEW : (continent as ScratchMapView));
    setMapViewFocusVersion((version) => version + 1);
  }, []);

  const selectMapView = useCallback((view: ScratchMapView) => {
    setMapView(view);
    setMapViewFocusVersion((version) => version + 1);
  }, []);

  const clearMapView = useCallback(() => {
    setMapView(null);
  }, []);

  const maxVisibleCountryCount = Math.max(0, ...visibleCountries.map((country) => country.count));
  const maxRegionCount = Math.max(0, ...(activeCountry?.regions.map((region) => region.count) ?? []));
  const maxCountyCount = Math.max(0, ...(activeCountry?.counties.map((county) => county.count) ?? []));
  const hasSupportedDetailMap = activeCountry?.name === "Sweden" || activeCountry?.name === "Iceland";
  const mapLevelLabel = MAP_LEVELS.find((level) => level.value === mapLevel)?.label ?? "Countries";
  const findCountLabel = scratch?.truncated ? `${scratch.limit}+ logged finds` : `${scratch?.totalFinds ?? 0} logged finds`;

  return (
    <AppShell>
      <header className="page-header">
        <span>
          <p className="eyebrow">Scratch-off coverage</p>
          <h1>Scratch Map</h1>
        </span>
      </header>
      <section className="map-stage scratch-stage">
        {error ? <p className="error">{error}</p> : null}
        <div className="map-toolbar scratch-toolbar">
          <strong>{findCountLabel}</strong>
          <span>
            {mapLevel === "countries" || hasSupportedDetailMap
              ? `${mapLevelLabel.toLowerCase()} in view`
              : "Country map shown until region data is added"}
          </span>
        </div>
        <div className="scratch-view-controls" aria-label="Map view">
          {mapViewOptions.map((option) => (
            <button
              key={option.value}
              className={mapView === option.value ? "active" : ""}
              type="button"
              onClick={() => selectMapView(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <ScratchMap
          countries={visibleCountries}
          activeCountry={activeCountry}
          countryFocusVersion={countryFocusVersion}
          level={mapLevel}
          maxCountryCount={maxVisibleCountryCount}
          view={mapView}
          viewFocusVersion={mapViewFocusVersion}
          selectedCountry={activeCountry?.name ?? null}
          onSelectCountry={selectCountry}
          onUserMove={clearMapView}
        />
      </section>
      <section className="panel scratch-panel">
        <div className="panel-heading">
          <span>
            <h2>Coverage</h2>
            <small>Countries darken as find counts grow, then drill into regions and counties.</small>
          </span>
          <div className="scratch-controls">
            <label>
              Map level
              <select value={mapLevel} onChange={(event) => setMapLevel(event.target.value as ScratchMapLevel)}>
                {MAP_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Continent
              <select value={activeContinent} onChange={(event) => selectContinent(event.target.value)}>
                {continents.map((continent) => (
                  <option key={continent} value={continent}>
                    {continent}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {mapLevel !== "countries" && !hasSupportedDetailMap ? (
          <p className="scratch-map-note">Region and county polygons are currently available for Sweden and Iceland. Select one of them to draw detail boundaries on the map.</p>
        ) : null}
        <div className="scratch-layout">
          <div className="scratch-country-list" aria-label="Countries with finds">
            {visibleCountries.map((country) => (
              <button
                key={country.name}
                className={activeCountry?.name === country.name ? "active" : ""}
                style={{ "--scratch-color": scratchColor(country.count, maxVisibleCountryCount) } as React.CSSProperties}
                type="button"
                onClick={() => selectCountry(country.name)}
              >
                <strong>{country.name}</strong>
                <span>
                  {country.continent} - {country.count}
                </span>
              </button>
            ))}
          </div>
          <div className="scratch-drilldown">
            <div className="scratch-drilldown-heading">
              <span>
                <h3>{activeCountry?.name ?? "No country yet"}</h3>
                <small>{activeCountry ? `${activeCountry.count} logged finds` : "Upload finds to start coverage"}</small>
              </span>
            </div>
            {mapLevel === "regions" ? (
              <div className="scratch-grid-wrap single">
                <div>
                  <h4>Regions</h4>
                  <div className="scratch-tile-grid">
                    {(activeCountry?.regions ?? []).map((region) => (
                      <LocationTile key={region.name} bucket={region} max={maxRegionCount} total={activeCountry?.count ?? 0} />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {mapLevel === "counties" ? (
              <div className="scratch-grid-wrap single">
                <div>
                  <h4>Counties</h4>
                  <div className="scratch-tile-grid">
                    {(activeCountry?.counties ?? []).map((county) => (
                      <LocationTile key={county.name} bucket={county} max={maxCountyCount} total={activeCountry?.count ?? 0} />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
