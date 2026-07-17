.PHONY: configure install uninstall start stop restart logs user-logs status single dual doctor validate

configure:
	./scripts/configure.sh

install:
	sudo ./scripts/install-system.sh "$${USER}"

uninstall:
	sudo ./scripts/uninstall-system.sh

start:
	sudo systemctl start webkde.service

stop:
	sudo systemctl stop webkde.service

restart:
	sudo systemctl restart webkde.service

logs:
	journalctl -u webkde.service -f

user-logs:
	journalctl --user -u webkde-session.service -u plasma-kwin_wayland.service -f

status:
	./scripts/display-mode.sh status

single:
	./scripts/display-mode.sh single

dual:
	./scripts/display-mode.sh dual

doctor:
	./scripts/doctor.sh

validate:
	bash -n scripts/*.sh container/defaults/startwm_wayland.sh
	xmllint --noout container/defaults/labwc.xml
	docker compose --env-file .env.example config --quiet
	@! rg -n '@(UID|RUNTIME|WIDTH|HEIGHT|KWIN_WRAPPER)@' \
		Dockerfile compose.yaml container README.md docs || \
		(echo "Unexpected unrendered system placeholder" >&2; exit 1)
	git diff --check
	git diff --cached --check
