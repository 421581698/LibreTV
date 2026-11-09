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
        self.assertIn("autoDeployTrigger: off", blueprint)
        self.assertIn("mountPath: /data", blueprint)
        self.assertIn("sizeGB: 1", blueprint)
        self.assertIn("generateValue: true", blueprint)
        self.assertNotIn("SCRAPLING_API_TOKEN: ", blueprint)

    def test_docker_image_uses_platform_port_and_healthcheck(self):
        dockerfile = (ROOT / "services/scrapling-collector/Dockerfile").read_text(encoding="utf-8")
        self.assertIn("${PORT:-10000}", dockerfile)
        self.assertIn("os.environ.get('PORT', '10000')", dockerfile)
        self.assertIn("scrapling install", dockerfile)

    def test_compose_keeps_internal_default_port(self):
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("- PORT=8000", compose)
        self.assertIn("http://scrapling-collector:8000", compose)

if __name__ == "__main__":
    unittest.main()
