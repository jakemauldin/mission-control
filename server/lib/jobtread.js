const PAVE_URL = "https://api.jobtread.com/pave";
const ORG_ID = "22NzKxPXx8Pf";

export async function queryJobTread(query) {
  const token = process.env.JOBTREAD_GRANT_KEY;
  if (!token) {
    return { ok: false, error: "JOBTREAD_GRANT_KEY not set" };
  }

  try {
    const res = await fetch(PAVE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `JobTread ${res.status}: ${text}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getJobDetail(jobId) {
  // Two queries: job info + cost items (costItems are at job level, not nested under costGroups)
  const [jobResult, costResult] = await Promise.all([
    queryJobTread({
      job: {
        $: { id: jobId },
        id: true,
        name: true,
        number: true,
        description: true,
        createdAt: true,
        closedOn: true,
        status: true,
        location: { name: true, address: true },
        costGroups: { nodes: { id: true, name: true } },
        // Get documents to find customer (account on first doc)
        documents: {
          $: { size: 5 },
          nodes: { id: true, account: { id: true, name: true } },
        },
      },
    }),
    queryJobTread({
      job: {
        $: { id: jobId },
        costItems: {
          $: { size: 100 },
          nodes: {
            id: true,
            name: true,
            price: true,
            cost: true,
            quantity: true,
            costGroup: { id: true, name: true },
          },
          nextPage: true,
        },
      },
    }),
  ]);

  if (!jobResult.ok) return jobResult;
  if (!costResult.ok) return costResult;

  const job = jobResult.data?.job || jobResult.data;
  const costItems = costResult.data?.job?.costItems?.nodes || [];
  let nextPage = costResult.data?.job?.costItems?.nextPage;

  // Paginate if more cost items exist. Hard cap: a bad nextPage cursor from the API
  // would otherwise loop forever (50 pages x 100 items is far beyond any real job).
  let pages = 0;
  while (nextPage && ++pages <= 50) {
    const more = await queryJobTread({
      job: {
        $: { id: jobId },
        costItems: {
          $: { size: 100, page: nextPage },
          nodes: { id: true, name: true, price: true, cost: true, quantity: true, costGroup: { id: true, name: true } },
          nextPage: true,
        },
      },
    });
    if (!more.ok) break;
    const moreItems = more.data?.job?.costItems?.nodes || [];
    costItems.push(...moreItems);
    nextPage = more.data?.job?.costItems?.nextPage;
    if (moreItems.length < 100) break;
  }

  // Attach cost items to job, grouped by costGroup
  job.costItems = costItems;

  // Derive customer from first document's account
  const docNodes = job.documents?.nodes || [];
  const firstAccount = docNodes.find((d) => d.account?.name)?.account;
  if (firstAccount) {
    job.customer = firstAccount;
  }

  return { ok: true, data: job };
}

// JobTread lists return 10 rows unless sized (cap 100), silently. Page with the
// nextPage cursor until it runs out. Hard cap so a bad cursor cannot loop forever.
const JOBS_CACHE_MS = 5 * 60 * 1000;
const JOBS_MAX = 1000;
let jobsCache = null; // { at, data }
let jobsInflight = null;

async function fetchAllJobs() {
  const all = [];
  let page = null;
  for (let i = 0; i < JOBS_MAX / 100; i++) {
    const result = await queryJobTread({
      organization: {
        $: { id: ORG_ID },
        jobs: {
          $: { size: 100, ...(page ? { page } : {}) },
          nodes: {
            id: true,
            name: true,
            number: true,
            description: true,
            closedOn: true,
            createdAt: true,
            location: { account: { name: true } },
          },
          nextPage: true,
        },
      },
    });
    if (!result.ok) return result;
    const jobs = result.data?.organization?.jobs;
    if (!jobs || !Array.isArray(jobs.nodes)) return { ok: true, data: result.data };
    all.push(...jobs.nodes);
    page = jobs.nextPage;
    if (!page || jobs.nodes.length === 0) break;
  }
  // Customer rides on the job's location account; flatten it for the UI.
  return {
    ok: true,
    data: all.slice(0, JOBS_MAX).map(({ location, ...j }) => ({ ...j, customer: location?.account?.name || null })),
  };
}

export async function getJobs() {
  if (jobsCache && Date.now() - jobsCache.at < JOBS_CACHE_MS) return { ok: true, data: jobsCache.data };
  // Share one fetch between concurrent callers (the poller and a page load).
  if (!jobsInflight) jobsInflight = fetchAllJobs().finally(() => { jobsInflight = null; });
  const result = await jobsInflight;
  if (result.ok && Array.isArray(result.data)) jobsCache = { at: Date.now(), data: result.data };
  // On a failed refresh, a stale list beats an empty page.
  else if (!result.ok && jobsCache) return { ok: true, data: jobsCache.data, stale: true };
  return result;
}

// Accept a JobTread id or Jake's job number ("119"). JT ids are long alphanumerics.
export async function resolveJobId(idOrNumber) {
  const key = String(idOrNumber);
  const r = await getJobs();
  if (!r.ok || !Array.isArray(r.data)) return key;
  const byId = r.data.find((j) => j.id === key);
  if (byId) return byId.id;
  const byNum = r.data.find((j) => String(j.number) === key);
  return byNum ? byNum.id : key;
}
