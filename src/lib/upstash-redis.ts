import { fetchWithTimeout } from "@/lib/fetch-timeout";

type UpstashPipelineResponseItem = {
  result?: unknown;
  error?: string;
};

const UPSTASH_REDIS_TIMEOUT_MS = 3_000;

function getUpstashRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    return null;
  }

  return {
    url: url.replace(/\/+$/, ""),
    token,
  };
}

export async function upstashPipeline(
  commands: Array<Array<string | number>>
): Promise<unknown[] | undefined> {
  if (!commands.length) {
    return [];
  }

  const config = getUpstashRedisConfig();
  if (!config) {
    return undefined;
  }

  const response = await fetchWithTimeout(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      commands.map((command) => command.map((part) => String(part)))
    ),
    cache: "no-store",
    timeoutMs: UPSTASH_REDIS_TIMEOUT_MS,
    timeoutLabel: "Upstash Redis pipeline",
  });

  if (!response.ok) {
    throw new Error(`Upstash Redis pipeline error: ${response.status}`);
  }

  const payload = (await response.json()) as UpstashPipelineResponseItem[];
  if (!Array.isArray(payload)) {
    throw new Error("Upstash Redis pipeline error: invalid response payload");
  }

  return payload.map((item, index) => {
    if (item?.error) {
      throw new Error(`Upstash Redis command ${index} failed: ${item.error}`);
    }
    return item?.result ?? null;
  });
}

export async function upstashCommand(
  command: Array<string | number>
): Promise<unknown | undefined> {
  const results = await upstashPipeline([command]);
  if (!results) {
    return undefined;
  }
  return results[0];
}
