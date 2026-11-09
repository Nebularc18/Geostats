--[[
Generic Country checker

Checks finds against COUNTRIES:  Z finds in Y countries (at least X finds in each country).
Version 2026-11-03. All original parameters keep their names, meaning and defaults. Enhancements were taken over
from the "Generic Country - Region - County Checker with Map Output" (country level only).

NOTE: defaults differ from the Region/County checker on purpose (existing tags rely on them):
      "countries" defaults to 1 and "findsTotal" defaults to 1 here (0 in the other checker).

Behaviour changes compared to the previous version of this script (same tag, possibly different result):
  - caches on the official exclusion list BMAFMJR are not counted ("ignoreBookmark": false restores the old behaviour)
  - the challenge cache itself and repeated logs of the same cache are not counted (before: counted again)
  - "TExcludedGCCodes" is applied (before: only "ExcludedGCCodes" had an effect)
  - caches without a country are not counted
  - the output (log, html) uses the format of the Region/County checker, see OUTPUT. The result (ok) is not affected by it.
  - country polygons are shown on the map by default ("showCountriesOnMap": false restores the old behaviour)

----------------------------------------------------------------------------------------------------------------
REQUIREMENTS
"countries": number of countries required (default: 1). Can be set to "all" when "country" is set: every country
  in the "country" list is required.
"findsPerCountry": number of finds required in each country (default: 1)
"findsTotal": total number of finds required (default: 1)

FILTERS (applied to the finds)
"types": string or array with cache types to be INCLUDED (default: all types).
  Supports the macros "Events" (all event types) and "Physical" (all types with a logbook).
"sizes": string or array with cache sizes to be INCLUDED (default: all sizes)
"country": string or array with countries to be INCLUDED (default: all countries). Besides country names it supports
  macros for country groups: "Europe", "North America", "South America", "Africa", "Asia", "Oceania", "Antarctica",
  "European Union" and Project-GC's lists "PGC.Europe", "PGC.Asia", "PGC.Africa", "PGC.Central America",
  "PGC.Oceania", "PGC.North America", "PGC.South America", "PGC.Antarctic and subantarctic islands".
  The continent macros are country-level: a country that spans two continents belongs to its primary continent.
"minVisitDate": only caches found on or after this date are counted (standard filter)
"maxPlacedDate": only caches placed BEFORE this date are counted
"difficulties": array of difficulty values 1.0 - 5.0 to be INCLUDED (default: all)
"terrains": array of terrain values 1.0 - 5.0 to be INCLUDED (default: all)
"minElevation": minimum elevation in meters a cache must have to be counted (default: none)
"maxElevation": maximum elevation in meters a cache must have to be counted (default: none)
"filter": optional PGC.GetFinds() filter object for anything not covered above (default: none).
  The parameters above take precedence when both set the same filter key.
"attributes": number or array of attribute ids that a cache must have, a negative id means "attribute is set to NO"
"attributes_required": how many of the listed "attributes" a cache must have at the same time (default: 1)
  (alias: "attributesPerCache")
"exclude_attributes": number or array of attribute ids; a cache having any of them is not counted

EXCLUSIONS
"ExcludedTypes": string or array with cache types to be EXCLUDED, supports "Events" and "Physical" (alias: "excludedTypes")
"ExcludedCountries": string or array with countries to be EXCLUDED (alias: "excludedCountries").
  The value "MostFoundCountry" excludes the country in which the player found the most caches.
"ExcludedGCCodes": string or array with GC codes that are not counted (aliases: "TExcludedGCCodes", "excludedCaches")
"excludeLocationless": do not count "Locationless Cache" (default: true)
"ignoreBookmark": do not count caches on the official "Caches Excluded from Souvenirs and Statistics" list
  (https://www.geocaching.com/plan/lists/BMAFMJR) (default: true)
The challenge cache itself and repeated logs of the same cache are never counted.

OUTPUT
The log contains one line "PASSED: ..." per fulfilled condition. The html contains a "PASSED: ..." or "FAILED: ..." line per
condition (countries, and total finds when "findsTotal" is greater than 1), optionally followed by tables.
"list": "show" - shortcut for "showCountriesInList": true together with "showCachesInList": true. An explicitly set
  "showCountriesInList" or "showCachesInList" takes precedence.
"showCountriesInList": list the countries as a table. true = the required number of countries, a number = that many
  countries, "all" = every country (default: false). Countries are sorted alphabetically.
"showCachesInList": list the caches below each listed country and the "findsTotal" caches (default: false)
"showProgressWhenQualified": also list partially qualified countries (countries with fewer than "findsPerCountry"
  finds) when the challenge is passed; they are always listed when it is not passed (default: false)
"countriesLog": your own text for the first line of the countries condition,
  default: "Find <findsPerCountry> caches in <countries> countries"
"findsTotalLog": your own text for the first line of the total finds condition,
  default: "Find <findsTotal> caches in total"
"log": text added at the very beginning of the log and html
"showCachesOnMap": show the caches of the passed countries (and the "findsTotal" caches) on the map (default: true)
"showCountriesOnMap": show country polygons on the map (default: true). Missing countries are shown only when
  "country" is set.
"colorCountryPassed": color of found countries (default: "#006030")
"colorCountryMissing": color of missing countries (default: "#600030")
"opacityCountry": opacity of country polygons (default: 0.1)
]]

local args             = {...}
local params           = args[1]
local conf             = params.config or {}
local profileName      = params.profileName
local profileId        = params.profileId
local challengeCode    = params.gccode -- gccode from the tag
local env              = params.environmentSettings or {}
local startTime        = os.time() -- PGC.GetCPUUsage() is not useful to prevent a timeout, so measure elapsed time
local maxExecutionTime = env.maxExecutionTime

PGC.print('Got profile name, ', profileName, '\n')
PGC.print('Got profile id ', profileId, '\n')

---------- constants ----------

local BOOKMARK_EXCLUDED = 'BMAFMJR' -- "Caches Excluded from Souvenirs and Statistics"
local LOG_URL           = 'http://www.geocaching.com/seek/log.aspx?lid='

-- defaults that differ from the original script, change here if you want the old behaviour back
local DEFAULT_IGNORE_BOOKMARK       = true
local DEFAULT_EXCLUDE_LOCATIONLESS  = true

local EVENT_TYPES = {
  'Event Cache', 'Cache In Trash Out Event', 'Mega-Event Cache', 'Giga-Event Cache',
  'Community Celebration Event', 'Geocaching HQ Block Party', 'Geocaching HQ Celebration'
}

local PHYSICAL_TYPES = {
  'Traditional Cache', 'Mystery Cache', 'Multi-Cache', 'Letterbox Hybrid', 'Wherigo Cache',
  'Project A.P.E. Cache', 'Geocaching HQ Cache'
}

local ALL_SIZES   = { 'Micro', 'Small', 'Regular', 'Large', 'Other', 'Virtual', 'Not chosen' }
local ALL_RATINGS = { 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0 }

-- country groups usable in "country". Country level only; countries spanning more than one continent are listed
-- on their primary continent.
local COUNTRY_GROUPS = {
  ['Europe'] = {
    'Åland Islands', 'Albania', 'Andorra', 'Austria', 'Belarus', 'Belgium', 'Bosnia and Herzegovina', 'Bulgaria',
    'Croatia', 'Czechia', 'Denmark', 'Estonia', 'Faroe Islands', 'Finland', 'France', 'Germany', 'Gibraltar',
    'Greece', 'Guernsey', 'Hungary', 'Iceland', 'Ireland', 'Isle of Man', 'Italy', 'Jersey', 'Latvia',
    'Liechtenstein', 'Lithuania', 'Luxembourg', 'Malta', 'Moldova', 'Monaco', 'Montenegro', 'Netherlands',
    'North Macedonia', 'Norway', 'Poland', 'Portugal', 'Romania', 'Russia', 'San Marino', 'Sark', 'Serbia',
    'Slovakia', 'Slovenia', 'Spain', 'Svalbard and Jan Mayen Islands', 'Sweden', 'Switzerland', 'Ukraine',
    'United Kingdom', 'Vatican City State'
  },
  ['North America'] = {
    'Anguilla', 'Antigua and Barbuda', 'Bahamas', 'Barbados', 'Belize', 'Bermuda', 'British Virgin Islands', 'Canada',
    'Cayman Islands', 'Costa Rica', 'Cuba', 'Dominica', 'Dominican Republic', 'El Salvador', 'Greenland', 'Grenada',
    'Guadeloupe', 'Guatemala', 'Haiti', 'Honduras', 'Jamaica', 'Martinique', 'Mexico', 'Montserrat', 'Nicaragua',
    'Panama', 'Puerto Rico', 'Saint Barthélemy', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Martin',
    'Saint Pierre and Miquelon', 'Saint Vincent and the Grenadines', 'Sint Maarten', 'Turks and Caicos Islands',
    'United States', 'US Virgin Islands'
  },
  ['South America'] = {
    'Argentina', 'Aruba', 'Bolivia', 'Bonaire, Sint Eustatius and Saba', 'Brazil', 'Chile', 'Colombia', 'Curaçao',
    'Ecuador', 'Falkland Islands', 'French Guiana', 'Guyana', 'Paraguay', 'Peru',
    'South Georgia and the South Sandwich Islands', 'Suriname', 'Trinidad and Tobago', 'Uruguay', 'Venezuela'
  },
  ['Africa'] = {
    'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cameroon',
    'Central African Republic', 'Chad', 'Comoros', 'Congo', "Côte d'Ivoire", 'Democratic Republic of the Congo',
    'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eritrea', 'Eswatini', 'Ethiopia', 'Gabon', 'Gambia', 'Ghana', 'Guinea',
    'Guinea-Bissau', 'Kenya', 'Lesotho', 'Liberia', 'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius',
    'Mayotte', 'Morocco', 'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Réunion', 'Rwanda', 'Saint Helena',
    'Sao Tome and Principe', 'Senegal', 'Seychelles', 'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan',
    'Sudan', 'Tanzania', 'Togo', 'Tunisia', 'Uganda', 'Western Sahara', 'Zambia', 'Zimbabwe'
  },
  ['Asia'] = {
    'Afghanistan', 'Armenia', 'Azerbaijan', 'Bahrain', 'Bangladesh', 'Bhutan', 'British Indian Ocean Territory',
    'Brunei', 'Cambodia', 'China', 'Christmas Island', 'Cocos (Keeling) Islands', 'Cyprus', 'Georgia', 'Hong Kong',
    'India', 'Indonesia', 'Iran', 'Iraq', 'Israel', 'Japan', 'Jordan', 'Kazakhstan', 'Kuwait', 'Kyrgyzstan', 'Laos',
    'Lebanon', 'Macao', 'Malaysia', 'Maldives', 'Mongolia', 'Myanmar', 'Nepal', 'North Korea', 'Oman', 'Pakistan',
    'Palestine', 'Philippines', 'Qatar', 'Saudi Arabia', 'Singapore', 'South Korea', 'Sri Lanka', 'Syria', 'Taiwan',
    'Tajikistan', 'Thailand', 'Timor-Leste', 'Türkiye', 'Turkmenistan', 'United Arab Emirates', 'Uzbekistan',
    'Vietnam', 'Yemen'
  },
  ['Oceania'] = {
    'American Samoa', 'Australia', 'Cook Islands', 'Fiji', 'French Polynesia', 'Guam', 'Kiribati', 'Marshall Islands',
    'Micronesia', 'Nauru', 'New Caledonia', 'New Zealand', 'Niue', 'Norfolk Island', 'Northern Mariana Islands',
    'Palau', 'Papua New Guinea', 'Pitcairn', 'Samoa', 'Solomon Islands', 'Tokelau', 'Tonga', 'Tuvalu',
    'US Minor Outlying Islands', 'Vanuatu', 'Wallis and Futuna Islands'
  },
  ['Antarctica'] = {
    'Antarctica', 'Bouvet Island', 'French Southern and Antarctic Territories', 'Heard Island and McDonald Islands'
  },
  ['European Union'] = {
    'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France',
    'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands',
    'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden'
  }
}

---------- helpers ----------

local function IfElse(condition, value1, value2)
  if condition then
    return value1
  end
  return value2
end

local function ToNumber(value, default)
  local n = tonumber(value)
  if n == nil then
    return default
  end
  return n
end

-- nil stays nil, a single value or an array becomes a new array
local function ToList(value)
  if value == nil then
    return nil
  end

  local list = {}
  if type(value) == 'table' then
    for _, item in ipairs(value) do
      list[#list + 1] = item
    end
  else
    list[1] = value
  end
  return list
end

local function ToSet(list)
  local set = {}
  for _, item in ipairs(list or {}) do
    set[item] = true
  end
  return set
end

-- merge the values (single value or array) of several config parameters (aliases) into one array
local function MergeParameters(...)
  local merged = {}
  for _, name in ipairs({...}) do
    for _, item in ipairs(ToList(conf[name]) or {}) do
      merged[#merged + 1] = item
    end
  end
  return merged
end

local function Subtract(list, removeList)
  local removeSet = ToSet(removeList)
  local result = {}
  for _, item in ipairs(list) do
    if not removeSet[item] then
      result[#result + 1] = item
    end
  end
  return result
end

-- replace the macros "Events" and "Physical" with concrete cache types
local function ExpandTypes(list)
  local result, seen = {}, {}

  local function add(cacheType)
    if not seen[cacheType] then
      seen[cacheType] = true
      result[#result + 1] = cacheType
    end
  end

  for _, cacheType in ipairs(list) do
    if cacheType == 'Events' then
      for _, t in ipairs(EVENT_TYPES) do add(t) end
    elseif cacheType == 'Physical' then
      for _, t in ipairs(PHYSICAL_TYPES) do add(t) end
    else
      add(cacheType)
    end
  end
  return result
end

-- country lists of Project-GC's continent maps, fetched only when a "PGC.*" macro is used
local pgcGroups = nil
local function GetPgcGroup(name)
  if pgcGroups == nil then
    pgcGroups = {}
    local definitions = PGC.GetContinentDefinitions()
    if type(definitions) == 'table' then
      for continent, countries in pairs(definitions) do
        local list = {}
        for _, country in pairs(countries) do -- pairs(), since this table starts at index 0
          list[#list + 1] = country
        end
        table.sort(list)
        pgcGroups['PGC.' .. continent] = list
      end
    end
  end
  return pgcGroups[name]
end

-- replace country group macros with the countries of the group; returns the new list and whether a macro was used
local function ExpandCountries(list)
  local result, seen, expanded = {}, {}, false

  local function add(country)
    if not seen[country] then
      seen[country] = true
      result[#result + 1] = country
    end
  end

  for _, name in ipairs(list) do
    local group = COUNTRY_GROUPS[name]
    if group == nil and type(name) == 'string' and string.sub(name, 1, 4) == 'PGC.' then
      group = GetPgcGroup(name)
    end

    if group ~= nil then
      expanded = true
      for _, country in ipairs(group) do add(country) end
    else
      add(name)
    end
  end
  return result, expanded
end

-- determine the country in which the player has the most finds (nil when there are no finds)
local function GetMostFoundCountry()
  local finds = PGC.GetFinds(profileId, { fields = {'country'}, excludeDupFinds = true, excludeTravelingGeocaches = true, order = 'OLDESTFIRST' })

  local findsPerCountry = {}
  for _, cache in ipairs(finds) do
    local country = cache.country
    if country ~= nil and country ~= '' then
      findsPerCountry[country] = (findsPerCountry[country] or 0) + 1
    end
  end

  local best, bestCount = nil, 0
  for country, count in pairs(findsPerCountry) do
    if count > bestCount or (count == bestCount and country < best) then -- alphabetical order decides ties
      best, bestCount = country, count
    end
  end
  return best
end

-- date string to a comparable number, i.e. "2018-05-01" -> 20180501
local function DateToNumber(date)
  if date == nil then
    return nil
  end
  return tonumber((string.gsub(tostring(date), '[^0-9]', '')))
end

---------- attributes ----------

-- check if an attribute is set on a cache; a negative number checks for the "NO" attribute
local function HasAttribute(cache, attribute)
  attribute = tonumber(attribute)
  if attribute == nil then
    return false
  end

  local prefix = 'attributes_set_'
  if attribute < 0 then
    attribute = -attribute
    prefix = 'attributes_unset_'
  end
  if attribute < 1 then
    return false
  end

  local index = attribute - 1 -- every attributes_*_N field is a bit mask of 32 attributes
  local mask = cache[prefix .. (math.floor(index / 32) + 1)]
  if mask == nil then
    return false
  end

  local bit = 2 ^ (index % 32)
  return mask % (bit + bit) >= bit
end

-- check if at least "required" of the listed attributes are present on the cache
local function HasAttributes(cache, attributes, required)
  local found = 0
  for _, attribute in ipairs(attributes) do
    if HasAttribute(cache, attribute) then
      found = found + 1
    end
    if found >= required then
      return true
    end
  end
  return false
end

-- single number or array -> array; an empty list means "no restriction" and results in nil
local function ToAttributeList(value)
  local list = ToList(value)
  if list == nil or #list == 0 then
    return nil
  end
  return list
end

---------- config ----------

local minFinds = ToNumber(conf.findsPerCountry, 1) -- minimum finds per country needed
local minTotal = ToNumber(conf.findsTotal, 1)      -- minimum total finds needed
-- list options. The old parameter "list": "show" switches on both new ones, unless they are set explicitly
local showCountriesInList = conf.showCountriesInList -- true, a number of countries or "all"
if showCountriesInList == nil then
  showCountriesInList = (conf.list == 'show')
end
local showCachesInList = conf.showCachesInList
if showCachesInList == nil then
  showCachesInList = (conf.list == 'show')
end
local showProgressWhenQualified = (conf.showProgressWhenQualified == true)

-- countries to be included ("country"), macros are resolved to country names
local countryList, countryListExpanded = nil, false
if conf.country ~= nil then
  countryList, countryListExpanded = ExpandCountries(ToList(conf.country))
end

-- excluded countries
local excludedCountries = {}
for _, name in ipairs(MergeParameters('ExcludedCountries', 'excludedCountries')) do
  if name == 'MostFoundCountry' then
    local mostFound = GetMostFoundCountry()
    if mostFound ~= nil then
      excludedCountries[mostFound] = true
      PGC.print('Excluded ', mostFound, ' as the country with most finds\n')
    end
  else
    excludedCountries[name] = true
  end
end

-- countries that can still be found: listed in "country" and not excluded (nil when "country" is not set)
local requiredCountries = nil
if countryList ~= nil then
  requiredCountries = {}
  for _, country in ipairs(countryList) do
    if not excludedCountries[country] then
      requiredCountries[#requiredCountries + 1] = country
    end
  end
end

-- minimum countries with finds needed
local minAreas
if conf.countries == 'all' then
  if requiredCountries ~= nil and #requiredCountries > 0 then
    minAreas = #requiredCountries
    PGC.print('ALL required countries resolved to ', minAreas, '\n')
  else
    minAreas = 1
    PGC.print('Warning: "countries": "all" needs "country" to be set, using 1\n')
  end
else
  minAreas = ToNumber(conf.countries, 1)
end

-- check the country names of the configuration, an invalid name would otherwise silently find nothing
local invalidCountryNames = {}
do
  local validNames = PGC.GetIso3166_1alpha2Table(true)
  if type(validNames) == 'table' then
    local checked = {}

    local function check(name)
      if type(name) == 'string' and name ~= 'MostFoundCountry' and not checked[name] then
        checked[name] = true
        if not validNames[name] then
          invalidCountryNames[#invalidCountryNames + 1] = name
          PGC.print('Warning: Country ', name, ' does not exist!\n')
        end
      end
    end

    for _, name in ipairs(countryList or {}) do check(name) end
    for name, _ in pairs(excludedCountries) do check(name) end
  end
end

local excludedTypes     = ToSet(ExpandTypes(MergeParameters('ExcludedTypes', 'excludedTypes')))
local excludedCaches    = ToSet(MergeParameters('ExcludedGCCodes', 'TExcludedGCCodes', 'excludedCaches'))
local excludeLocationless = IfElse(conf.excludeLocationless == nil, DEFAULT_EXCLUDE_LOCATIONLESS, conf.excludeLocationless)

local ignoredCaches = {} -- caches on the official "Caches Excluded from Souvenirs and Statistics" list
if IfElse(conf.ignoreBookmark == nil, DEFAULT_IGNORE_BOOKMARK, conf.ignoreBookmark) then
  PGC.print('Ignoring caches on bookmark list https://www.geocaching.com/plan/lists/', BOOKMARK_EXCLUDED, '\n')
  local bookmarkList = PGC.GetBookmarklist(BOOKMARK_EXCLUDED)
  if type(bookmarkList) == 'table' then
    ignoredCaches = ToSet(bookmarkList)
  end
end

local maxPlacedDate = nil
if conf.maxPlacedDate ~= nil then
  maxPlacedDate = DateToNumber(conf.maxPlacedDate)
  if maxPlacedDate == nil then
    PGC.print('Warning: "maxPlacedDate" is not a valid date and is ignored\n')
  end
end

local minElevation = tonumber(conf.minElevation)
local maxElevation = tonumber(conf.maxElevation)

local includeAttributes  = ToAttributeList(conf.attributes)
local excludeAttributes  = ToAttributeList(conf.exclude_attributes)
local requiredAttributes = ToNumber(conf.attributes_required, ToNumber(conf.attributesPerCache, 1))

-- map options. Polygons are not drawn when a name is invalid, to prevent a checker crash
local showCachesOnMap     = IfElse(conf.showCachesOnMap == nil, true, conf.showCachesOnMap)
local showCountriesOnMap  = IfElse(conf.showCountriesOnMap == nil, true, conf.showCountriesOnMap == true) and (#invalidCountryNames == 0)
local colorCountryPassed  = conf.colorCountryPassed or '#006030'
local colorCountryMissing = conf.colorCountryMissing or '#600030'
local opacityCountry      = conf.opacityCountry or 0.1

---------- get the finds ----------

local filter = {}
if type(conf.filter) == 'table' then
  for key, value in pairs(conf.filter) do
    filter[key] = value
  end
end

if conf.types ~= nil then filter.types = ExpandTypes(ToList(conf.types)) end
if countryList ~= nil then filter.country = countryListExpanded and countryList or conf.country end
if conf.minVisitDate ~= nil then filter.minVisitDate = conf.minVisitDate end

-- an exclusion list on top of the include list (or of all values) results in one include list
local function CombineFilter(include, excluded, allValues)
  excluded = ToList(excluded)
  if excluded == nil then
    return ToList(include)
  end
  return Subtract(ToList(include) or allValues, excluded)
end

if conf.sizes ~= nil or conf.excludedSizes ~= nil then
  filter.sizes = CombineFilter(conf.sizes, conf.excludedSizes, ALL_SIZES)
end
if conf.difficulties ~= nil or conf.excludedDifficulties ~= nil then
  filter.difficulties = CombineFilter(conf.difficulties, conf.excludedDifficulties, ALL_RATINGS)
end
if conf.terrains ~= nil or conf.excludedTerrains ~= nil then
  filter.terrains = CombineFilter(conf.terrains, conf.excludedTerrains, ALL_RATINGS)
end

local fields = { 'country', 'cache_name', 'gccode', 'type', 'size', 'visitdate', 'hidden', 'log_id' }
if includeAttributes or excludeAttributes then
  fields[#fields + 1] = 'attributes_set'
  fields[#fields + 1] = 'attributes_unset'
end
if minElevation ~= nil or maxElevation ~= nil then
  fields[#fields + 1] = 'elevation'
end
if showCountriesOnMap and showCachesOnMap then
  fields[#fields + 1] = 'latitude'
  fields[#fields + 1] = 'longitude'
end

local finds = PGC.GetFinds(profileId, { fields = fields, filter = filter, order = 'OLDESTFIRST' })
PGC.print('Got ', #finds, ' found caches\n')

---------- count the finds ----------

-- check if a find is counted for the challenge
local function IsCountable(cache)
  local country = cache.country
  if country == nil or country == '' then
    return false
  end

  if excludedCaches[cache.gccode] or ignoredCaches[cache.gccode] then
    return false
  end

  if excludedCountries[country] or excludedTypes[cache.type] then
    return false
  end

  if excludeLocationless and cache.type == 'Locationless Cache' then
    return false
  end

  if minElevation ~= nil or maxElevation ~= nil then
    local elevation = tonumber(cache.elevation)
    if elevation == nil
      or (minElevation ~= nil and elevation < minElevation)
      or (maxElevation ~= nil and elevation > maxElevation)
    then
      return false
    end
  end

  if maxPlacedDate ~= nil then
    local placed = DateToNumber(cache.hidden)
    if placed == nil or placed >= maxPlacedDate then
      return false
    end
  end

  if includeAttributes and not HasAttributes(cache, includeAttributes, requiredAttributes) then
    return false
  end

  if excludeAttributes and HasAttributes(cache, excludeAttributes, 1) then
    return false
  end

  return true
end

local listLimit      = math.max(math.ceil(minFinds), 1) -- caches listed per country
-- the total is an own condition when more than one find is required (or when no country is required at all)
local showTotalCondition = minTotal > 1 or (minAreas <= 0 and minTotal > 0)
local counted        = {}   -- gccodes of already processed caches
local numDuplicates  = 0
local total          = 0    -- all counted finds
local totalList      = {}   -- the first "minTotal" counted finds
local byCountry      = {}   -- country -> { count = number of finds, caches = first "listLimit" finds }
local countryOrder   = {}   -- countries in the order of the first find

for _, cache in ipairs(finds) do
  local code = cache.gccode
  if code ~= nil and code ~= '' then
    if code == challengeCode then
      PGC.print('Not counting this challenge ', code, ' towards its qualifications\n')
    elseif counted[code] then
      numDuplicates = numDuplicates + 1
    else
      counted[code] = true

      if IsCountable(cache) then
        total = total + 1
        if showTotalCondition and total <= minTotal then
          totalList[total] = cache
        end

        local country = cache.country
        local entry = byCountry[country]
        if entry == nil then
          entry = { count = 0, caches = {} }
          byCountry[country] = entry
          countryOrder[#countryOrder + 1] = country
        end

        entry.count = entry.count + 1
        if #entry.caches < listLimit then
          entry.caches[#entry.caches + 1] = cache
        end
      end
    end
  end
end

if numDuplicates > 0 then
  PGC.print(numDuplicates, ' repeated logs of already counted caches ignored\n')
end

local areasFound = 0
for _, country in ipairs(countryOrder) do
  if byCountry[country].count >= minFinds then
    areasFound = areasFound + 1
  end
end

local ok = (areasFound >= minAreas) and (total >= minTotal)
PGC.print('Countries: ', areasFound, '/', minAreas, ', finds in total: ', total, '/', minTotal, ', ok: ', tostring(ok), '\n')

-- allow unattended checks to return without worrying about generating logs, html or maps
if env.cli then
  return { ok = ok }
end

---------- output ----------
-- Format of the Region/County checker: every condition prints a header, optional tables and a "PASSED:/FAILED:" line.
-- The log (text) contains only the PASSED lines, the html contains everything.

local htmlParts = {}
local logLines  = {}
local map = { caches = {}, polygons = {}, polygonLines = {}, circles = {}, correctedCoordinatesInUse = false }
local mapCaches, mapCacheCodes = {}, {} -- caches shown on the map

local function Plural(count, singular, plural)
  return count .. ' ' .. IfElse(count == 1, singular, plural)
end

-- " (3 required)", or nothing when no minimum is required
local function RequiredText(required)
  if required > 0 then
    return ' (' .. required .. ' required)'
  end
  return ''
end

local function AddHtml(text)
  htmlParts[#htmlParts + 1] = text
end

local function CountryWithFlag(country)
  return PGC.Icon.CountryFlag(country) .. '&nbsp;' .. country
end

local function AddToMap(caches)
  if not showCachesOnMap then
    return
  end

  for _, cache in ipairs(caches) do
    if not mapCacheCodes[cache.gccode] then
      mapCacheCodes[cache.gccode] = true
      mapCaches[#mapCaches + 1] = cache
      map.caches[#map.caches + 1] = cache.gccode
    end
  end
end

local function CacheRow(index, cache, withCountry)
  return '<tr><td>' .. index .. '</td>'
    .. IfElse(withCountry, '<td>' .. CountryWithFlag(cache.country) .. '</td>', '')
    .. '<td>' .. PGC.Icon.GeocacheType(cache.type) .. '&nbsp;' .. PGC.Icon.GeocacheSize(cache.size) .. '&nbsp;'
    .. '<a href="' .. LOG_URL .. cache.log_id .. '" target="_blank">' .. (cache.cache_name or '') .. ' (' .. cache.gccode .. ')</a></td>'
    .. '<td>' .. PGC.Icon.GeocacheFound() .. '&nbsp;' .. (cache.visitdate or '') .. '</td></tr>'
end

-- table with caches, the country column is left out when the caches are listed below their country
local function CacheTable(caches, withCountry, title)
  if #caches == 0 then
    return ''
  end

  local parts = { (title or '') .. IfElse(title ~= nil, '<br>', ''), '<table class="table-condensed" style="width:100%">',
    '<tr><th style="width:5%">#</th>', IfElse(withCountry, '<th style="width:10%">Country</th>', ''),
    '<th>Cache</th><th style="width:10%">Found date</th></tr>' }
  for index, cache in ipairs(caches) do
    parts[#parts + 1] = CacheRow(index, cache, withCountry)
  end
  parts[#parts + 1] = '</table>'
  return table.concat(parts)
end

-- table with countries (first "maxRows" of them, 0 = all) and, optionally, their caches
local function CountriesTable(countries, maxRows)
  if #countries == 0 then
    return ''
  end

  local parts = { '<table class="table-condensed" style="width:100%"><tr><th>#</th><th>Country</th><th>Caches</th></tr>' }
  for index, country in ipairs(countries) do
    if maxRows == 0 or index <= maxRows then
      local entry = byCountry[country]
      parts[#parts + 1] = '<tr><td>' .. index .. '</td><td>' .. CountryWithFlag(country) .. '</td><td>'
        .. Plural(entry.count, 'cache', 'caches') .. RequiredText(minFinds) .. '</td></tr>'

      if showCachesInList and #entry.caches > 0 then
        parts[#parts + 1] = '<tr><td></td><td colspan="2">' .. CacheTable(entry.caches, false) .. '</td></tr>'
      end
    end
  end
  parts[#parts + 1] = '</table>'
  return table.concat(parts)
end

-- html and log line of a condition
local function AddResult(passed, header, found, singular, plural)
  local text = header .. ' (' .. Plural(found, singular, plural) .. ' found).'
  if passed then
    text = 'PASSED: ' .. text
    logLines[#logLines + 1] = text
  else
    text = 'FAILED: ' .. text
  end
  AddHtml(text .. '<br><br>')
  PGC.print(text, '\n')
end

-- countries sorted alphabetically: fully qualified ones and the ones with some finds only (partially qualified)
local passedCountries, partialCountries = {}, {}
for _, country in ipairs(countryOrder) do
  if byCountry[country].count >= minFinds then
    passedCountries[#passedCountries + 1] = country
  else
    partialCountries[#partialCountries + 1] = country
  end
end
table.sort(passedCountries)
table.sort(partialCountries)

-- text added to the very beginning by the tag
if type(conf.log) == 'string' then
  AddHtml(conf.log .. '<br><br>')
  logLines[#logLines + 1] = conf.log
end

---- countries
local countriesHeader = conf.countriesLog
if type(countriesHeader) ~= 'string' then
  local parts = { IfElse(minAreas > 0, 'Find', 'Found') }
  if minFinds > 0 then
    parts[#parts + 1] = Plural(minFinds, 'cache', 'caches')
    parts[#parts + 1] = 'in'
  end
  parts[#parts + 1] = IfElse(minAreas > 0, Plural(minAreas, 'country', 'countries'), 'countries')
  countriesHeader = table.concat(parts, ' ')
end

-- number of countries to list: true = the required number, a number = that many, "all" = all (0 = all)
local maxCountryRows = 0
if type(showCountriesInList) == 'number' then
  maxCountryRows = showCountriesInList
elseif showCountriesInList == true then
  maxCountryRows = minAreas
end
maxCountryRows = math.max(maxCountryRows, 0)

if showCountriesInList then
  AddHtml(countriesHeader .. '<br>' .. CountriesTable(passedCountries, maxCountryRows))
end
for _, country in ipairs(passedCountries) do
  AddToMap(byCountry[country].caches)
end

local countriesPassed = areasFound >= minAreas
if minAreas > 0 then
  AddResult(countriesPassed, countriesHeader, areasFound, 'country', 'countries')
else
  AddHtml('<br>')
end

-- progress: countries with some finds, but less than required, and countries without any find
if showCountriesInList and (showProgressWhenQualified or not countriesPassed) then
  if #partialCountries > 0 then
    AddHtml('Partially Qualified Countries<br>' .. CountriesTable(partialCountries, 0))
  end

  local missing = {}
  for _, country in ipairs(requiredCountries or {}) do
    if byCountry[country] == nil and minFinds > 0 then
      missing[#missing + 1] = '<li>' .. CountryWithFlag(country) .. '</li>'
    end
  end
  if #missing > 0 then
    AddHtml('Missing Countries<br><ul>' .. table.concat(missing) .. '</ul>')
  end
end

---- finds in total
if showTotalCondition then
  local totalHeader = conf.findsTotalLog
  if type(totalHeader) ~= 'string' then
    totalHeader = 'Find ' .. Plural(minTotal, 'cache', 'caches') .. ' in total'
  end

  if showCachesInList then
    AddHtml(CacheTable(totalList, true, totalHeader))
  end
  AddToMap(totalList)
  AddResult(total >= minTotal, totalHeader, total, 'cache', 'caches')
end

if #invalidCountryNames > 0 then
  AddHtml('<h1>Warning: invalid checker configuration!</h1>')
  for _, name in ipairs(invalidCountryNames) do
    AddHtml('Country "' .. name .. '" does not exist!<br>')
  end
end

---------- map ----------

-- extend the map's outbound box to include the given coordinates
local function ExtendBounds(minLat, minLon, maxLat, maxLon)
  minLat, minLon, maxLat, maxLon = tonumber(minLat), tonumber(minLon), tonumber(maxLat), tonumber(maxLon)
  if minLat == nil or minLon == nil or maxLat == nil or maxLon == nil then
    return
  end

  local box = map.outboundBox
  if box ~= nil then
    minLat = math.min(minLat, box[1])
    minLon = math.min(minLon, box[2])
    maxLat = math.max(maxLat, box[3])
    maxLon = math.max(maxLon, box[4])
  end
  map.outboundBox = { minLat, minLon, maxLat, maxLon }
end

local polygonCache = {}

-- get country polygon, fetches polygon data on first call
local function GetCountryPolygon(countryName)
  local polygon = polygonCache[countryName]
  if polygon == nil then
    if maxExecutionTime ~= nil and (os.time() - startTime + 5) > maxExecutionTime then
      return nil -- skip this part if less than 5 seconds left before timeout
    end

    local polygonData = PGC.GetCountryPolygonInfo(countryName)
    if polygonData ~= nil then
      polygon = polygonData[1]
      polygonCache[countryName] = polygon
    end
  end
  return polygon
end

local function DrawCountry(countryName, color)
  local polygon = GetCountryPolygon(countryName)
  if polygon == nil then
    PGC.print('DrawCountry("', countryName, '"): polygon not found!\n')
    return
  end

  local minLat, maxLat, minLon, maxLon = tonumber(polygon.minLat), tonumber(polygon.maxLat), tonumber(polygon.minLon), tonumber(polygon.maxLon)
  if minLat == nil or maxLat == nil or minLon == nil or maxLon == nil then
    PGC.print('DrawCountry("', countryName, '"): polygon misses minLat/maxLat/minLon/maxLon!\n')
    return
  end

  if polygon.id == nil then -- no outline available, show a rectangle
    polygon.id = { { minLat, minLon }, { maxLat, minLon }, { maxLat, maxLon }, { minLat, maxLon } }
  end

  map.polygons[#map.polygons + 1] = { polygon = polygon.id, color = color, fillOpacity = opacityCountry, htmlTooltip = countryName }
  ExtendBounds(minLat, minLon, maxLat, maxLon)
end

if showCountriesOnMap then
  local passed = {}
  for _, country in ipairs(countryOrder) do
    if byCountry[country].count >= minFinds then
      passed[country] = true
      DrawCountry(country, colorCountryPassed)
    end
  end

  for _, country in ipairs(requiredCountries or {}) do -- missing countries are known only when "country" is set
    if not passed[country] then
      DrawCountry(country, colorCountryMissing)
    end
  end

  for _, cache in ipairs(mapCaches) do
    ExtendBounds(cache.latitude, cache.longitude, cache.latitude, cache.longitude)
  end
end

return { ok = ok, log = table.concat(logLines, '\n'), html = table.concat(htmlParts), map = map }