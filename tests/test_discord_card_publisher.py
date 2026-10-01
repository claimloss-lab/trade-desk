import base64
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from publish_discord_card import DEFAULT_CARDS, merge_card, publish  # noqa: E402


class DiscordCardPublisherTests(unittest.TestCase):
    def test_publish_accepts_http_200_update_without_retrying(self):
        file_data = {
            'content': base64.b64encode(json.dumps(DEFAULT_CARDS).encode('utf-8')).decode('ascii'),
            'sha': 'existing-file-sha',
        }
        with patch('publish_discord_card.github_token_from_credential_manager', return_value='test-token'), \
                patch('publish_discord_card.api_json') as api, \
                patch('publish_discord_card.time.sleep') as sleep:
            api.side_effect = lambda method, token, body=None: (
                (200, file_data) if method == 'GET' else
                (200, {'commit': {'sha': '1234567890abcdef'}})
            )
            result = publish('signals', 'new signal', 'Portfolio Pullback Monitor')

        self.assertEqual(result['kind'], 'signals')
        self.assertEqual(result['characters'], len('new signal'))
        self.assertEqual(result['commit'], '1234567890ab')
        self.assertEqual(api.call_count, 2)
        self.assertEqual([call.args[0] for call in api.call_args_list], ['GET', 'PUT'])
        sleep.assert_not_called()

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
