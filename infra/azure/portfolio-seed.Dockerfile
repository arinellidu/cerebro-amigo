FROM postgres:16-alpine

COPY seed/portfolio.sql /seed/portfolio.sql
COPY azure/run-portfolio-seed.sh /usr/local/bin/run-portfolio-seed

# O contexto pode ser empacotado em Windows (CRLF) pelo operador do ACR build.
# Normalize o entrypoint dentro da imagem para manter a execução reproduzível.
RUN sed -i 's/\r$//' /usr/local/bin/run-portfolio-seed \
    && chmod 0555 /usr/local/bin/run-portfolio-seed

ENTRYPOINT ["/usr/local/bin/run-portfolio-seed"]
