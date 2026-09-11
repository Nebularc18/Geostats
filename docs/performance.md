# Performance changes

## Map revisions and rollout

Deploy migration `000035_map_revisions` before starting the updated API. Run the normal database migration deployment step, then deploy the API and clients. Older API instances can run against the added table during a rolling deployment. Existing cursor tokens expire once they reach the new API and the web client restarts pagination.

The API reads a per-user `map_revisions` row before and after each map page. The wire value is an opaque string with a `v2:` prefix. A user without a revision row starts at zero. No bigint enters a JSON response.

PostgreSQL statement triggers queue affected users in the writer's transaction, and a deferred trigger advances their revisions at commit. They cover insert, update and delete on finds, hides, imports, profiles and corrected coordinates. A shared cache update invalidates every user with an affected find or hide. Cache and user deletion also exercise cascading triggers. Each transaction increments once per affected user, and a rollback discards the queued changes with the data. Counter updates run after data writes and lock users in a consistent order, preventing the data-row/counter-row deadlock reproduced during review. The pending-change table is empty after commit.

The triggers deliberately invalidate conservatively on updates. They cover API, worker, restore and direct SQL writes without requiring each caller to remember an invalidation method. Normal user-cache raw data changes do not change map results. New tables or fields that affect map results must be added to this mutation inventory. Do not disable these triggers during a restore that can overlap map requests, or force the deferred revision constraint to IMMEDIATE during a write transaction. Existing application paths do neither.

Transition tables and statement triggers follow the [PostgreSQL trigger documentation](https://www.postgresql.org/docs/16/sql-createtrigger.html).

## Client loading and rendering

Web map text searches debounce for 300 ms. The loader publishes the first validated page, batches later progress, and clears a source when its snapshot expires or a terminal request fails. Existing results remain visible while a new filter request loads. The 20,000-point cap remains per unfiltered source; filtered histories continue paging through all matches.

Web and mobile stats screens share a 30-second in-memory summary cache with request deduplication. Successful mutations and observed import completions invalidate it. Session changes clear cached data and prevent old responses from being applied. Mobile FTF and Trackables screens now own virtualized SectionList scrolling roots, and the trackable map selector is a horizontal FlatList. Trackable journey grouping appends to each group rather than copying the previous array for each point.

## Import writes

The worker resolves at most eight unique caches concurrently. After a cache fails, it stops scheduling new cache work and waits for active workers before propagating the error. New finds use `createMany` batches of 500 inside the existing transaction. Existing-find matching, manual FTF flags, trusted cache metadata, and hide log locking retain their current behavior.

Eight is a conservative initial bound, not a guarantee of spare database capacity. Tune it against the deployed connection pool and worker concurrency. Bulk inserts reduce 10,000 individual new-find insert calls to 20 batch calls, excluding updates and cache metadata work.

## Verification

`packages/db/src/map-revisions.integration.test.ts` creates an isolated schema with synthetic rows when `GEOSTATS_TEST_DATABASE_URL` is set. It applies the actual revision migration and checks bulk writes, shared cache edits, ownership changes, empty updates, rollback, visibility across connections, concurrent increments, and cascaded deletion. It drops the schema afterward.

`apps/worker/src/imports/import-processor.integration.test.ts` also accepts `GEOSTATS_TEST_DATABASE_URL`. It requires the migrated schema and uses unique synthetic fixtures that it removes afterward. Real GPX imports verify a 501-find success, an idempotent reimport with a manually cleared FTF flag, and rollback after a forced failure in batch two. The worker's 33 tests passed with this integration test enabled.

The full migration history, including the new migration, was applied successfully to a disposable PostgreSQL 16 database with PostGIS. API tests check cursor rejection during mutations and exactly two revision reads per page.

A local microbenchmark compared the previous five-operation revision calculation with the new single-row read on a synthetic 10,000-find history. After five warmups, 30 sequential samples gave these results:

| Revision calculation | Median | p95 |
| --- | ---: | ---: |
| Previous calculation | 5.83 ms | 8.47 ms |
| Persisted revision read | 0.60 ms | 0.70 ms |

This measures the revision calculation only on an idle local database. It does not measure complete map loading or predict production latency. Each map page does two checks, so the structural change reduces revision operations from ten to two per page. Shared cache edits now spend additional work invalidating affected users at write time.

The trackable grouping helper was also benchmarked on 10,000 synthetic points for one trackable, with five warmups and 30 samples in Node.js. The previous repeated array copying took 84.346 ms median, and the new append-based grouping took 0.205 ms. This isolates grouping, not native map rendering or device performance.

A Chromium smoke test against a synthetic fixture API verified that the map displays its first 5,000 points before the remaining pages finish. Typing ten characters generated one request per map source after the debounce. Dashboard → Stats → Milestones → Dashboard used one summary request within the freshness window. No page errors occurred. Web tests passed 87 checks and the production build; mobile tests passed 35 checks and TypeScript.

The final workspace run passed all 469 tests with zero skips using the fresh database with deferred revisions. All workspace typechecks passed. The concurrent-write regression succeeds with the deferred trigger, and no revision queue rows remain after commit or rollback.

## Release checks

Compare cold and warm navigation on a fixed network and device. Record first map points, completed load, request count, summary bytes, import duration, API latency during imports, and mobile memory and frame times. Use 1k, 10k and 50k synthetic histories. Test edits and imports during pagination, repeat imports, account/server switches, logout, list pagination and row actions. Native scrolling still needs verification in an Android release build; unit tests and TypeScript checks cannot measure native frame times.
