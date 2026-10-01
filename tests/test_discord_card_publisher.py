import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from publish_discord_card import DEFAULT_CARDS, merge_card  # noqa: E402


class DiscordCardPublisherTests(unittest.TestCase):
    def test_updating_one_channel_replaces_only_that_channel(self):
        old = {
            'signals': {'content': 'old signal', 'updatedAt': '2026-01-01T00:00:00Z', 'discordUrl': DEFAULT_CARDS['signals']['discordUrl'], 'sourceJob': 'old'},
            'morningAiNews': {'content': 'keep this', 'updatedAt': '2026-01-02T00:00:00Z', 'discordUrl': DEFAULT_CARDS['morningAiNews']['discordUrl'], 'sourceJob': 'morning'},
        }
        updated = merge_card(old, 'signals', 'new signal', '2026-02-01T00:00:00Z', 'Portfolio Pullback Monitor')
        self.assertEqual(updated['signals']['content'], 'new signal')
        self.assertEqual(updated['signals']['sourceJob'], 'Portfolio Pullback Monitor')
        self.assertEqual(updated['morningAiNews'], old['morningAiNews'])

    def test_only_the_two_configured_card_kinds_are_accepted(self):
        with self.assertRaises(ValueError):
            merge_card({}, 'general', 'post', '2026-02-01T00:00:00Z', 'someone')

    def test_empty_and_oversized_posts_are_rejected(self):
        with self.assertRaises(ValueError):
            merge_card({}, 'signals', '  ', '2026-02-01T00:00:00Z', 'job')
        with self.assertRaises(ValueError):
            merge_card({}, 'signals', 'x' * 100001, '2026-02-01T00:00:00Z', 'job')


if __name__ == '__main__':
    unittest.main()
