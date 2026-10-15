# 저장소 루트에서 docker build -f workers/Dockerfile .
FROM python:3.12-slim
WORKDIR /worker
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Etc/UTC
COPY workers/requirements.txt /worker/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 worker \
    && useradd --uid 10001 --gid 10001 --create-home worker
COPY workers/collection_files /worker/workers/collection_files
USER 10001:10001
# 기본 시작은 로컬 자체 검사다. 비밀 파일은 실제 실행/배포 점검 때만 읽는다.
ENTRYPOINT ["python", "-m", "workers.collection_files.container_entrypoint"]
CMD ["check"]
