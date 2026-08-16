import { describe, expect, it, vi } from "vitest";
import { pluginHttpLimits, requestPluginHttp } from "@/lib/plugin-http";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("hosted plugin HTTP", () => {
  it("requests public JSON APIs with bounded structured output", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({ method: "POST", redirect: "manual" });
      expect(init?.body).toBe('{"city":"深圳"}');
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      return Response.json({ data: { temperature: 28 } }, { headers: { "x-api-version": "1", "set-cookie": "secret=hidden" } });
    }) as typeof fetch;

    await expect(requestPluginHttp({
      url: "https://api.example.com/weather",
      method: "POST",
      body: { city: "深圳" },
    }, new AbortController().signal, { fetch: fetchMock, lookup: publicLookup })).resolves.toEqual({
      url: "https://api.example.com/weather",
      status: 200,
      ok: true,
      headers: expect.not.objectContaining({ "set-cookie": expect.anything() }),
      body: { data: { temperature: 28 } },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("blocks local, private DNS and redirect targets before connecting", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } })) as typeof fetch;
    const signal = new AbortController().signal;

    await expect(requestPluginHttp({ url: "http://localhost/" }, signal, { fetch: fetchMock, lookup: publicLookup }))
      .rejects.toThrow("PLUGIN_HTTP_PRIVATE_ADDRESS_DENIED");
    await expect(requestPluginHttp({ url: "https://private.example/" }, signal, {
      fetch: fetchMock,
      lookup: async () => [{ address: "10.0.0.8", family: 4 }],
    })).rejects.toThrow("PLUGIN_HTTP_PRIVATE_ADDRESS_DENIED");
    await expect(requestPluginHttp({ url: "https://public.example/" }, signal, { fetch: fetchMock, lookup: publicLookup }))
      .rejects.toThrow("PLUGIN_HTTP_PRIVATE_ADDRESS_DENIED");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects responses larger than the plugin runtime limit", async () => {
    const fetchMock = vi.fn(async () => new Response("x".repeat(pluginHttpLimits.maxResponseBytes + 1))) as typeof fetch;
    await expect(requestPluginHttp({ url: "https://api.example.com/large" }, new AbortController().signal, {
      fetch: fetchMock,
      lookup: publicLookup,
    })).rejects.toThrow("PLUGIN_HTTP_RESPONSE_TOO_LARGE");
  });
});
