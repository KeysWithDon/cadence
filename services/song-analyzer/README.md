# Faithful Keys private analysis worker

This is an original integration layer, not a copy of another product. Deploy it
on a private CPU/GPU service behind the authenticated Faithful Keys API—not on
GitHub Pages or a public URL. The browser uploads directly to a short-lived,
user-scoped object-store location and only the server sends a secure object
reference to this worker.

Pipeline: authorized temporary input → instrumental separation → beat grid →
timestamped chord recognition → constrained harmonic review → normalized chart
metadata. Vocal and instrumental files never leave the worker and are removed
when the job's temporary directory closes.

Required runtime configuration:

```text
UVR_INSTRUMENTAL_MODEL=UVR-MDX-NET-Inst_HQ_3.onnx
CHORD_RECOGNIZER_HOME=/opt/chord-recognizer
CHORD_RECOGNIZER_CHECKPOINT=/opt/models/chord-recognizer.pth
CHORD_RECOGNIZER_CONFIG=config/ChordMini.yaml
CHORD_RECOGNIZER_MODEL=ChordNet
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=server-only-secret-key
ANALYSIS_WORKER_TOKEN=long-random-shared-token
```

Run the container with `uvicorn app:app --host 0.0.0.0 --port 8080` (the
included Dockerfile does this by default). Configure Supabase's
`queue-song-analysis` Edge Function with this worker URL and the same
`ANALYSIS_WORKER_TOKEN`. The Edge Function authenticates the browser request
and row-level security checks job ownership before sending the object key here.
The worker rechecks that the object stays within the user's folder, deletes the
object after success or failure, and never sends audio, stems, raw model output,
prompts, or private reasoning back to the client. Results retain confidence
labels and remain editable.

The container installs the ChordMini implementation and its included ChordNet
checkpoint. Mount the approved UVR model at `UVR_MODEL_DIRECTORY` before
serving real jobs (the default model filename is
`UVR-MDX-NET-Inst_HQ_3.onnx`). Build this image in a trusted CI environment,
then deploy it to a private long-running CPU/GPU container host. It must not be
placed in GitHub Pages or an Edge Function, which cannot run these models.

Any model code or model artifact used in deployment needs an independent
licensing review and the required notices. Keep those notices in deployment
documentation; no third-party branding is required in the Faithful Keys UI.
