PY ?= python

.PHONY: check quick clean-preview clean clean-all

check:          ## full health check (pytest, eval run, Streamlit boot)
	$(PY) check.py

quick:          ## fast health check, skips the slow stuff
	$(PY) check.py --quick

clean-preview:  ## show what would be deleted
	$(PY) clean.py --all

clean:          ## delete caches and junk only
	$(PY) clean.py --yes

clean-all:      ## also delete generated data, eval outputs, build artifacts
	$(PY) clean.py --all --yes
