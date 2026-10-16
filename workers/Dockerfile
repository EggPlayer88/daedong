# 저장소 루트에서 docker build -f workers/Dockerfile .
FROM python:3.12-slim
WORKDIR /worker
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY workers/requirements.txt /worker/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home worker
COPY workers/collection_files /worker/workers/collection_files
USER 10001
# 기본 시작은 로컬 자체 검사다. 주기 실행/연결/정책 승인은 운영 안내에서 별도 설정한다.
ENTRYPOINT ["python", "-m", "workers.collection_files"]
CMD ["check"]
