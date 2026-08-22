import unittest

from analysis_service import infer_key, normalize_chord_symbol


class AnalysisServiceTest(unittest.TestCase):
    def test_normalizes_recognizer_symbols_without_changing_the_root(self):
        self.assertEqual(normalize_chord_symbol("D♯:min7"), "D♯m7")
        self.assertEqual(normalize_chord_symbol("D♭:maj7"), "D♭maj7")
        self.assertEqual(normalize_chord_symbol("B:min7b5"), "Bm7♭5")
        self.assertEqual(normalize_chord_symbol("C:7"), "C7")

    def test_key_suggestion_uses_detected_harmony(self):
        result = infer_key([
            {"chordSymbol": "Cmaj7"}, {"chordSymbol": "Dm7"},
            {"chordSymbol": "G7"}, {"chordSymbol": "Cmaj7"},
        ])
        self.assertEqual(result, {"key": "C", "mode": "major"})

    def test_ambiguous_or_empty_results_keep_a_safe_editable_default(self):
        self.assertEqual(infer_key([]), {"key": "C", "mode": "major"})


if __name__ == "__main__":
    unittest.main()
