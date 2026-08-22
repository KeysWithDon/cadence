FROM python:3.11-slim
WORKDIR /app
ARG CHORDMINI_REPOSITORY=https://github.com/ptnghia-j/ChordMini.git
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN git clone --depth 1 "$CHORDMINI_REPOSITORY" /opt/chordmini \
    && pip install --no-cache-dir -r /opt/chordmini/requirements.txt \
    && pip install --no-cache-dir -r requirements.txt
COPY analysis_service.py app.py ./
ENV PORT=8080
ENV CHORD_RECOGNIZER_HOME=/opt/chordmini
ENV CHORD_RECOGNIZER_CHECKPOINT=/opt/chordmini/checkpoints/2e1d_model_best.pth
ENV UVR_MODEL_DIRECTORY=/opt/models/uvr
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
