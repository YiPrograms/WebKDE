.PHONY: configure install uninstall start stop restart logs user-logs status doctor validate

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
	journalctl --user -u webkde-session.service -u webkde-bridge.service -u webkde-inhibit.service -u plasma-kwin_wayland.service -f

status:
	./scripts/display-mode.sh status

doctor:
	./scripts/doctor.sh

validate:
	bash -n scripts/*.sh container/*.sh container/defaults/*.sh
	docker compose --env-file .env.example config --quiet
	@! rg -n '@(UID|RUNTIME|WIDTH|HEIGHT|MAX_SCREENS|KWIN_WRAPPER|SYSTEMCTL)@' \
		Dockerfile compose.yaml container README.md docs || \
		(echo "Unexpected unrendered system placeholder" >&2; exit 1)
	git diff --check
	git diff --cached --check
