.PHONY: configure host-setup install uninstall start stop restart logs status single dual doctor validate

configure:
	./scripts/configure.sh

host-setup:
	@echo "Run interactively: sudo ./scripts/host-setup.sh $${USER}"

install: configure
	./scripts/install-user.sh

uninstall:
	./scripts/uninstall-user.sh

start:
	systemctl --user start webkde-session.service

stop:
	systemctl --user stop webkde-session.service webkde-container.service

restart:
	systemctl --user restart webkde-container.service webkde-session.service

logs:
	journalctl --user -u webkde-container.service -u webkde-session.service -f

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
	git diff --check
	git diff --cached --check
