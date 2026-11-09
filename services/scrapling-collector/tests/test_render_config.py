from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]

class RenderDeploymentConfigTests(unittest.TestCase):
    def test_render_blueprint_is_manual_paid_and_persistent(self):
        blueprint = (ROOT / "render.yaml").read_text(encoding="utf-8")
        self.assertIn("runtime: docker", blueprint)
        self.assertIn("plan: 2c-4g", blueprint)
        self.assertIn("rootDir: services/scrapling-collector", blueprint)
        self.assertIn("dockerfilePath: services/scrapling-collector/Dockerfile", blueprint)
        self.assertIn('autoDeployTrigger: "off"', blueprint)
        self.assertIn("mountPath: /data", blueprint)
        self.assertIn("sizeGB: 1", blueprint)
        self.assertIn("generateValue: true", blueprint)
        self.assertNotIn("SCRAPLING_API_TOKEN: ", blueprint)

    def test_docker_image_uses_platform_port_and_healthcheck(self):
        dockerfile = (ROOT / "services/scrapling-collector/Dockerfile").read_text(encoding="utf-8")
        self.assertIn("${PORT:-10000}", dockerfile)
        self.assertIn("os.environ.get('PORT', '10000')", dockerfile)
        self.assertIn("scrapling install", dockerfile)
        self.assertIn("PLAYWRIGHT_BROWSERS_PATH=/opt/collector-browsers", dockerfile)
        entrypoint = (ROOT / "services/scrapling-collector/docker-entrypoint.sh").read_text(encoding="utf-8")
        self.assertIn("chown -R collector:collector /data", entrypoint)
        self.assertIn("exec gosu collector", entrypoint)
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("    cap_add:" + chr(10) + "      - CHOWN", compose)

    def test_compose_keeps_internal_default_port(self):
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("- PORT=8000", compose)
        self.assertIn("http://scrapling-collector:8000", compose)

    def test_compose_defaults_scrapling_egress_gate_to_disabled(self):
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("SCRAPLING_EGRESS_FIREWALL_CONFIRMED=${SCRAPLING_EGRESS_FIREWALL_CONFIRMED:-0}", compose)

if __name__ == "__main__":
    unittest.main()
