# 공식 LTS의 확인한 패치·다중 아키텍처 digest를 고정한다. 출처와 갱신은 ../README.md.
FROM clamav/clamav:1.4.6_base@sha256:1b483c3988220dae0e107911e2788c2a671ccd4ec01901777f8ac02e518d3af2
USER root
RUN addgroup -g 10001 -S workhub \
    && adduser -u 10001 -G workhub -h /var/lib/clamav -s /bin/false -S -D workhub \
    && mkdir -p /run/clamav /var/lib/clamav \
    && chown 10001:10001 /run/clamav /var/lib/clamav \
    && chmod 0770 /run/clamav /var/lib/clamav
COPY workers/deploy/clamav/clamd.conf /etc/clamav/clamd.conf
COPY workers/deploy/clamav/freshclam.conf /etc/clamav/freshclam.conf
ENV TZ=Etc/UTC
USER 10001:10001
VOLUME ["/var/lib/clamav", "/run/clamav"]
# 공식 이미지의 기본 TCP healthcheck 대신 Compose의 Unix 소켓 점검을 사용한다.
HEALTHCHECK NONE
ENTRYPOINT ["clamd", "--foreground", "--config-file=/etc/clamav/clamd.conf"]
