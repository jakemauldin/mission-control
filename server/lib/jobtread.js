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

export async function getJobs() {
  const result = await queryJobTread({
    organization: {
      $: { id: ORG_ID },
      jobs: {
        nodes: {
          id: true,
          name: true,
          number: true,
          description: true,
          closedOn: true,
          createdAt: true,
        },
      },
    },
  });

  if (!result.ok) return result;

  // Extract the nodes array from the nested response
  const nodes = result.data?.organization?.jobs?.nodes;
  if (Array.isArray(nodes)) {
    return { ok: true, data: nodes };
  }

  return { ok: true, data: result.data };
}
