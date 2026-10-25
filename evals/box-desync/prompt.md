The Stress Box's crowd no longer plays the same run after run: `node x replay tests/replays/box-4-hop.replay.json`
fails, and so do the crowd's unit tests. Find the cause and fix it, so that every replay gives its committed golden
hashes again, run after run, and two runs of the same scene in one process agree.

The goldens are right, and the crowd should play exactly as they recorded it: do not re-record, edit or remove any
replay.
