/**
 * Suite snapshots in the backup bucket.
 *
 * The restic repository the `backup` service writes is encrypted and chunked —
 * only restic can read it, and it holds the whole database. A *suite* is a
 * different thing: one product's tests, templates, flows and steps as the plain
 * JSON that `GET /products/{id}/export` produces. Keeping those as ordinary
 * objects beside the repository, under `suites/`, means anyone with the bucket
 * key can list and read them, another Flowdeck can import them, and nothing
 * here needs restic or the encryption password.
 *
 * Configured by the same variables the backup service uses (`BACKUP_REPOSITORY`
 * in restic's `s3:<endpoint>/<bucket>[/<prefix>]` form, plus the S3 key pair).
 * With none set the store reports itself unavailable and the routes say so.
 */
import { S3Client } from "bun";

export interface SuiteEntry {
  /** `<savedAt>_<productId>` — what the API addresses a snapshot by. */
  id: string;
  productId: string;
  productName: string;
  savedAt: string;
  savedBy: string;
  bytes: number;
  tests: number;
  templates: number;
}

export interface SuiteDocument {
  /** What is stored: the export bundle plus a small header. */
  flowdeck: { savedAt: string; savedBy: string; productId: string };
  product: { id: string; name: string; description: string };
  tests: unknown[];
  templates: unknown[];
}

const PREFIX = "suites/";

function parseRepository(repo: string) {
  // restic: s3:https://host[:port]/bucket[/path]  or  s3:s3.amazonaws.com/bucket
  const m = /^s3:(?:(https?:\/\/[^/]+)|([^/]+))\/([^/]+)(?:\/(.*))?$/.exec(repo.trim());
  if (!m) return undefined;
  const endpoint = m[1] ?? `https://${m[2]}`;
  return { endpoint, bucket: m[3]!, prefix: m[4] ? `${m[4].replace(/\/+$/, "")}/` : "" };
}

function configure() {
  const repo = process.env.BACKUP_REPOSITORY ?? "";
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY ?? "";
  const secretAccessKey = process.env.BACKUP_S3_SECRET_KEY ?? "";
  const parsed = repo ? parseRepository(repo) : undefined;
  if (!parsed || !accessKeyId || !secretAccessKey) return undefined;
  return {
    client: new S3Client({ endpoint: parsed.endpoint, bucket: parsed.bucket, accessKeyId, secretAccessKey }),
    prefix: parsed.prefix + PREFIX,
    where: `${parsed.endpoint}/${parsed.bucket}/${parsed.prefix}${PREFIX}`,
  };
}

let store: ReturnType<typeof configure> | null | undefined;
function s3() {
  if (store === undefined) store = configure() ?? null;
  return store;
}

export function suiteStoreStatus() {
  const s = s3();
  return s ? { available: true as const, where: s.where } : { available: false as const, where: null };
}

const idOf = (key: string, prefix: string) => key.slice(prefix.length).replace(/\.json$/, "");
const keyOf = (id: string, prefix: string) => `${prefix}${id}.json`;
const ID = /^[0-9TZ:.-]+_[0-9a-f-]{36}$/;

export function isSuiteId(id: string) {
  return ID.test(id);
}

export async function listSuites(productId?: string): Promise<SuiteEntry[]> {
  const s = s3();
  if (!s) return [];
  const out: SuiteEntry[] = [];
  let token: string | undefined;
  do {
    const page = await s.client.list({ prefix: s.prefix, maxKeys: 1000, continuationToken: token });
    for (const o of page.contents ?? []) {
      const id = idOf(o.key, s.prefix);
      if (!isSuiteId(id)) continue;
      const pid = id.slice(id.indexOf("_") + 1);
      if (productId && pid !== productId) continue;
      // The header is in the object; one small read each keeps the listing honest
      // about names and counts without a second index to maintain.
      const doc = (await s.client.file(o.key).json()) as SuiteDocument;
      out.push({
        id,
        productId: pid,
        productName: doc.product?.name ?? "",
        savedAt: doc.flowdeck?.savedAt ?? id.slice(0, id.indexOf("_")),
        savedBy: doc.flowdeck?.savedBy ?? "",
        bytes: o.size ?? 0,
        tests: doc.tests?.length ?? 0,
        templates: doc.templates?.length ?? 0,
      });
    }
    token = page.isTruncated ? page.nextContinuationToken : undefined;
  } while (token);
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveSuite(bundle: Omit<SuiteDocument, "flowdeck">, savedBy: string): Promise<SuiteEntry> {
  const s = s3();
  if (!s) throw new Error("suite store not configured");
  const savedAt = new Date().toISOString();
  const id = `${savedAt}_${bundle.product.id}`;
  const doc: SuiteDocument = { flowdeck: { savedAt, savedBy, productId: bundle.product.id }, ...bundle };
  const body = JSON.stringify(doc);
  await s.client.write(keyOf(id, s.prefix), body, { type: "application/json" });
  return {
    id,
    productId: bundle.product.id,
    productName: bundle.product.name,
    savedAt,
    savedBy,
    bytes: Buffer.byteLength(body),
    tests: bundle.tests.length,
    templates: bundle.templates.length,
  };
}

export async function readSuite(id: string): Promise<SuiteDocument | undefined> {
  const s = s3();
  if (!s || !isSuiteId(id)) return undefined;
  const f = s.client.file(keyOf(id, s.prefix));
  if (!(await f.exists())) return undefined;
  return (await f.json()) as SuiteDocument;
}

export async function deleteSuite(id: string): Promise<boolean> {
  const s = s3();
  if (!s || !isSuiteId(id)) return false;
  const f = s.client.file(keyOf(id, s.prefix));
  if (!(await f.exists())) return false;
  await f.delete();
  return true;
}
