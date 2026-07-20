.PHONY: configure deploy undeploy install uninstall start stop restart logs user-logs status doctor validate

configure:
	./scripts/configure.sh

deploy:
	./scripts/deploy.sh

undeploy:
	./scripts/undeploy.sh

install: deploy

uninstall: undeploy

start:
	systemctl --user start webkde.service

stop:
	systemctl --user stop webkde.service

restart:
	systemctl --user restart webkde.service

logs:
	journalctl --user -u webkde.service -f

user-logs:
	journalctl --user -u webkde-session.service -u webkde-bridge.service -u webkde-wallet.service -u webkde-inhibit.service -u plasma-kwin_wayland.service -f

status:
	./scripts/display-mode.sh status

doctor:
	./scripts/doctor.sh

validate:
	bash -n install.sh scripts/*.sh container/*.sh container/defaults/*.sh
	docker compose --env-file .env.example config --quiet
	docker compose --env-file .env.example -f compose.yaml -f compose.gpu.yaml config --quiet
	@! rg -n '@(ENV_FILE|RUNTIME|WIDTH|HEIGHT|MAX_SCREENS|KWIN_WRAPPER|SYSTEMCTL|WALLET_CREDENTIAL)@' \
		Dockerfile compose*.yaml container README.md docs || \
		(echo "Unexpected unrendered system placeholder" >&2; exit 1)
	git diff --check
	git diff --cached --check
