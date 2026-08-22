import { createClient } from "npm:@supabase/supabase-js@2";
const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return reply({ error: "Use POST." }, 405);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Sign in before starting analysis." }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publicKey) return reply({ error: "The analysis service is not configured." }, 500);
  const client = createClient(supabaseUrl, publicKey, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return reply({ error: "Your session has expired. Please sign in again." }, 401);
  let jobId = "";
  try { ({ jobId } = await request.json()); } catch { return reply({ error: "A job id is required." }, 400); }
  if (typeof jobId !== "string" || !jobId) return reply({ error: "A job id is required." }, 400);
  const { data: job, error: jobError } = await client.from("analysis_jobs").select("id, chart_id, source_type, source_object_key, status, progress, error, created_at, completed_at").eq("id", jobId).single();
  if (jobError || !job) return reply({ error: "That private job was not found." }, 404);
  if (job.status === "completed" || job.status === "review") return reply({ job });
  if (job.source_type === "youtube") {
    const { data, error } = await client.from("analysis_jobs").update({ status: "review", progress: 100, completed_at: new Date().toISOString(), error: "Upload audio you own or are permitted to analyze to run recognition." }).eq("id", job.id).select("id, source_type, status, progress, error, created_at, completed_at").single();
    return error ? reply({ error: error.message }, 500) : reply({ job: data });
  }
  if (!job.source_object_key) return reply({ error: "The private audio object is missing." }, 400);
  const workerUrl = Deno.env.get("ANALYSIS_WORKER_URL");
  const workerToken = Deno.env.get("ANALYSIS_WORKER_TOKEN");
  if (!workerUrl || !workerToken) return reply({ error: "Private audio analysis is not enabled yet." }, 503);
  const { data: processing, error: processingError } = await client.from("analysis_jobs").update({ status: "processing", progress: 5, error: null }).eq("id", job.id).select("id, source_type, status, progress, error, created_at, completed_at").single();
  if (processingError || !processing) return reply({ error: processingError?.message ?? "Could not start the private job." }, 500);
  try {
    const workerBase = workerUrl.endsWith("/") ? workerUrl.slice(0, -1) : workerUrl;
    const dispatched = await fetch(workerBase + "/jobs", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + workerToken }, body: JSON.stringify({ jobId: job.id, userId: auth.user.id, chartId: job.chart_id, sourceObjectKey: job.source_object_key }) });
    if (!dispatched.ok) throw new Error("The private worker returned " + dispatched.status + ".");
    return reply({ job: processing }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The private worker could not be reached.";
    const { data } = await client.from("analysis_jobs").update({ status: "failed", progress: 0, error: message, completed_at: new Date().toISOString() }).eq("id", job.id).select("id, source_type, status, progress, error, created_at, completed_at").single();
    return reply({ job: data, error: message }, 502);
  }
});
