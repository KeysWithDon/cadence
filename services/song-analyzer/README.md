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
UVR_INSTRUMENTAL_MODEL=<approved local UVR-family instrumental model name>
CHORD_RECOGNIZER_HOME=/opt/chord-recognizer
CHORD_RECOGNIZER_CHECKPOINT=/opt/models/chord-recognizer.pth
CHORD_RECOGNIZER_CONFIG=config/ChordMini.yaml
CHORD_RECOGNIZER_MODEL=ChordNet
```

Install with `python -m pip install -r requirements.txt`. The orchestration API
must authenticate the user, authorize their object reference for every job and
chart action, rate-limit jobs, enforce a retention policy, and delete the
original secure object after completion. Do not send audio, stems, raw model
output, prompts, or private reasoning back to the client. Results must retain
confidence labels and remain editable.

Any model code or model artifact used in deployment needs an independent
licensing review and the required notices. Keep those notices in deployment
documentation; no third-party branding is required in the Faithful Keys UI.
