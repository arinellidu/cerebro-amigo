FROM postgres:16-alpine

COPY migrations /migrations
COPY azure/run-migrations.sh /usr/local/bin/run-migrations

RUN chmod 0555 /usr/local/bin/run-migrations

ENTRYPOINT ["/usr/local/bin/run-migrations"]
