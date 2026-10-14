P=/var/tmp/pg17pkg/node_modules/@embedded-postgres/linux-x64/native
export LD_LIBRARY_PATH=$P/lib
PGB=$P/bin
D=/var/tmp/r0pg
PSQL="psql -h $D -p 55433 -X -q -v ON_ERROR_STOP=1"
