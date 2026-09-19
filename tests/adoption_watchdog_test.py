import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
import zlib

spec = importlib.util.spec_from_file_location('watchdog', Path(__file__).resolve().parents[1]/'tools/adoption_video_watchdog.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))

def png():
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB',16,16,8,2,0,0,0)) + chunk(b'IDAT',zlib.compress((b'\0'+b'\x90\x40\x20'*16)*16)) + chunk(b'IEND',b'')

class AssemblyTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='pawborough-watchdog-test-'))
        self.frames = self.root/'frames'; self.frames.mkdir()
        for i in range(25): (self.frames/f'frame-{i:05d}.png').write_bytes(png())
        self.output = self.root/'clip.mp4'

    def test_encoder_failure_cannot_publish_or_report_done(self):
        self.output.write_bytes(b'existing-output-preserved')
        with self.assertRaises(subprocess.CalledProcessError):
            w.assemble(self.frames,self.output,25,'test',ffmpeg='/bin/false')
        self.assertEqual(self.output.read_bytes(),b'existing-output-preserved')
        self.assertEqual(json.loads(self.output.with_suffix('.status.json').read_text(encoding='utf-8'))['status'],'failed')

    def test_probe_failure_cannot_publish(self):
        with self.assertRaises(subprocess.CalledProcessError):
            w.assemble(self.frames,self.output,25,'test',ffprobe='/bin/false')
        self.assertFalse(self.output.exists())
        self.assertEqual(json.loads(self.output.with_suffix('.status.json').read_text(encoding='utf-8'))['status'],'failed')

    def test_real_encode_is_complete_only_at_expected_count(self):
        j=w.assemble(self.frames,self.output,25,'all_frames')
        self.assertEqual((j['status'],j['encodedFrames']),('complete',25))
        (self.frames/'frame-00025.png').write_bytes(b'partial-write')
        j=w.assemble(self.frames,self.output,30,'wall_clock_cap')
        self.assertEqual((j['status'],j['encodedFrames']),('partial',25))

if __name__ == '__main__': unittest.main()
