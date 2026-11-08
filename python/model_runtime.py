"""Runs only in an optional, isolated ML environment. Official weights, CPU inference."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import urllib.request

RELEASES = {
    'handwriting': {
        'repo': 'generic-neuromotor-interface',
        'commit': 'b6bf250e2be5a67b23488104335373cdb87a15c9',
        'weights': 'https://fb-ctrl-oss.s3.amazonaws.com/neuromotor-data/checkpoints/handwriting/handwriting.tar',
        'sha256': 'da9cecc2deeab6bd8b685444a44386c86f48bdec1f6732ee1281089085f3328d',
    },
    'pose': {
        'repo': 'emg2pose',
        'commit': '5f6f62b1a0a08426adffe55900842e75a8adb38c',
        'weights': 'https://fb-ctrl-oss.s3.amazonaws.com/emg2pose/emg2pose_model_checkpoints.tar.gz',
        'sha256': '164e0bcbb52c25b116e77b799d8eb81c59994090608c73de3946c87e34c3db66',
    },
}
DEPENDENCIES = ['torch==2.4.1', 'numpy==1.26.4', 'scipy==1.14.1', 'hydra-core==1.3.2', 'torchmetrics==1.4.3', 'python-Levenshtein==0.26.1', 'Unidecode==1.3.8']


def report(message):
    print(json.dumps({'event': 'progress', 'message': message}), flush=True)


def download(url, target, expected=None):
    if target.is_file() and expected and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
        return
    request = urllib.request.Request(url, headers={'User-Agent': 'Runes-Model-Lab/1.0'})
    partial = target.with_suffix(target.suffix + '.part')
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(request, timeout=60) as response, partial.open('wb') as output:
            total = int(response.headers.get('Content-Length', 0))
            received, last = 0, -1
            while chunk := response.read(1024 * 1024):
                received += len(chunk)
                if received > 1024**3:
                    raise ValueError('Download exceeds the 1 GiB archive limit')
                digest.update(chunk)
                output.write(chunk)
                percent = received * 100 // total if total else received // 1024**2
                if percent != last:
                    report(f'Downloading {received / 1024**2:.1f} MiB' + (f' of {total / 1024**2:.1f} MiB' if total else ''))
                    last = percent
        if expected and digest.hexdigest() != expected:
            raise ValueError('Official checkpoint checksum did not match; download rejected')
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)


def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        if sum(m.size for m in members) > 2 * 1024**3:
            raise ValueError('Archive is too large')
        for member in members:
            if not (member.isfile() or member.isdir()) or not (root / member.name).resolve().is_relative_to(root):
                raise ValueError('Unsafe archive entry rejected')
        tar.extractall(destination, members=members, filter='data')


def child_env():
    env = dict(os.environ, PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1')
    env.pop('PYTHONHOME', None)
    return env


def install(root, model):
    root.mkdir(parents=True, exist_ok=True)
    directory = root / model
    directory.mkdir(exist_ok=True)
    (directory / 'ready.json').unlink(missing_ok=True)
    runtime = root / 'runtime/bin/python'
    if not runtime.is_file():
        report('Creating a separate Python environment')
        subprocess.run([sys.executable, '-m', 'venv', str(root / 'runtime')], check=True)
    report('Installing CPU inference dependencies. First install can take several minutes.')
    subprocess.run([str(runtime), '-m', 'pip', 'install', '--disable-pip-version-check', *DEPENDENCIES], env=child_env(), check=True)
    release = RELEASES[model]
    source = directory / 'source.tar.gz'
    report('Downloading pinned Meta source code')
    download(f"https://codeload.github.com/facebookresearch/{release['repo']}/tar.gz/{release['commit']}", source)
    extract(source, directory / 'source')
    report('Downloading official pretrained weights')
    weights = directory / 'weights.tar'
    download(release['weights'], weights, release['sha256'])
    extract(weights, directory / 'weights')
    report('Checking model loading and a CPU forward pass')
    subprocess.run([str(runtime), '-u', __file__, 'verify', '--root', str(root), '--model', model], env=child_env(), check=True)
    (directory / 'ready.json').write_text(json.dumps({'version': 1, **release}))
    source.unlink(missing_ok=True)
    weights.unlink(missing_ok=True)
    report('Installation verified')


def load_model(root, model):
    import torch
    from hydra.utils import instantiate
    from omegaconf import OmegaConf
    torch.set_num_threads(2)
    directory = root / model
    source = next((directory / 'source').iterdir())
    sys.path.insert(0, str(source))
    if model == 'handwriting':
        config = OmegaConf.load(next((directory / 'weights').rglob('model_config.yaml')))
        checkpoint = torch.load(next((directory / 'weights').rglob('model_checkpoint.ckpt')), map_location='cpu', weights_only=False)
        network = instantiate(config.lightning_module.network)
        network.load_state_dict({k.removeprefix('network.'): v for k, v in checkpoint['state_dict'].items() if k.startswith('network.')}, strict=True)
        from generic_neuromotor_interface.handwriting_utils import CTCGreedyDecoder
        decoder = CTCGreedyDecoder()
        return network.eval(), decoder
    checkpoint = torch.load(next((directory / 'weights').rglob('regression_vemg2pose.ckpt')), map_location='cpu', weights_only=False)
    network = instantiate(checkpoint['hyper_parameters']['network_conf'], _convert_='all')
    network.load_state_dict({k.removeprefix('model.'): v for k, v in checkpoint['state_dict'].items() if k.startswith('model.')}, strict=True)
    return network.eval(), None


def prepare(rows, mapping, scale=0.2008):
    import numpy as np
    from scipy.signal import butter, sosfiltfilt, resample_poly
    values = np.asarray(rows, dtype=np.float64)
    if values.ndim != 2 or values.shape[1] != 8 or not 6144 <= len(values) <= 24576 or not np.isfinite(values).all() or values.min() < 0 or values.max() > 65535:
        raise ValueError('Expected 3–12 seconds of eight-channel unsigned ADC samples')
    # Community ADC scale estimate, not a verified factory calibration. Remove DC before scaling.
    values = (values - np.median(values, axis=0)) * scale
    values = sosfiltfilt(butter(4, 40, btype='highpass', fs=2048, output='sos'), values, axis=0)
    values = resample_poly(values, 125, 128, axis=0)
    result = np.empty((len(values), 16), dtype=np.float32)
    if mapping == 'repeat':
        result[:] = np.repeat(values, 2, axis=1)
    elif mapping == 'interpolate':
        result[:, ::2] = values
        result[:, 1::2] = (values + np.roll(values, -1, axis=1)) / 2
    else:
        raise ValueError('Unknown mapping')
    return result


def pose_landmarks(frames):
    """Use the released UmeTrack model; bypass its Python-3.12-incompatible wrapper annotations."""
    import torch
    import emg2pose
    from emg2pose.UmeTrack.lib.common.hand import HandModel
    from emg2pose.UmeTrack.lib.common.hand_skinning import skin_landmarks
    path = Path(emg2pose.__file__).parent / 'UmeTrack/dataset/generic_hand_model.json'
    data = json.loads(path.read_text())
    count = len(frames)
    fields = {}
    for key, value in data.items():
        tensor = torch.tensor(value)
        fields[key] = tensor.expand(count, *tensor.shape)
    hand = HandModel(**fields)
    angles = torch.as_tensor(frames, dtype=torch.float32)
    angles = torch.cat([angles, torch.zeros(count, 2)], dim=1)
    points = skin_landmarks(hand, angles, torch.eye(4).expand(count, 4, 4))
    if not torch.isfinite(points).all():
        raise ValueError('Hand geometry produced nonfinite landmarks')
    return points.tolist()


def predict(network, decoder, values, model):
    import numpy as np
    import torch
    tensor = torch.as_tensor(values.T.copy()).unsqueeze(0)
    with torch.inference_mode():
        if model == 'handwriting':
            emissions, slc = network(tensor)
            if not torch.isfinite(emissions).all():
                raise ValueError('Model produced nonfinite character scores')
            lengths = network.compute_time_downsampling(torch.tensor([len(values)]), slc)
            decoded = decoder.decode_batch(emissions.movedim(0, 1).numpy(), lengths)
            text = decoder._charset.labels_to_str(decoded[0])
            return {'text': text, 'frames': int(emissions.shape[1])}
        angles = network._predict_pose(tensor, torch.zeros(1, 20))
        if not torch.isfinite(angles).all():
            raise ValueError('Model produced nonfinite joint angles')
        # Keep a bounded animation in joint-angle order, in radians.
        frames = angles[0].T.numpy()
        duration = len(frames) / network.rollout_freq
        frames = frames[::max(1, int(np.ceil(len(frames) / 240)))]
        return {'angles': frames.tolist(), 'landmarks': pose_landmarks(frames), 'geometry': 'Meta UmeTrack generic hand', 'frames': len(frames), 'units': 'radians', 'playback_seconds': duration, 'offset_seconds': network.left_context / 2000}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['install', 'verify', 'infer'])
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--model', required=True, choices=RELEASES)
    parser.add_argument('--capture', type=Path)
    parser.add_argument('--mapping', choices=['repeat', 'interpolate'], default='repeat')
    args = parser.parse_args()
    if args.action == 'install':
        install(args.root, args.model)
        return
    network, decoder = load_model(args.root, args.model)
    import numpy as np
    if args.action == 'verify':
        predict(network, decoder, np.zeros((24000, 16), dtype=np.float32), args.model)
        report('CPU forward pass passed')
        return
    if args.model == 'handwriting' and args.mapping == 'repeat':
        raise ValueError('Repeated channels are unsupported for handwriting: singular matrix-log features')
    capture = json.loads(args.capture.read_text())
    if capture.get('sample_rate') != 2048 or capture.get('channels') != 8:
        raise ValueError('Unsupported capture format')
    values = prepare(capture['rows'], args.mapping)
    # The causal handwriting model needs its full left context before decoding.
    # Repeat the resting prefix rather than losing the start of a short recording.
    if args.model == 'handwriting':
        values = np.concatenate([np.zeros((19014, 16), dtype=np.float32), values, np.zeros((974, 16), dtype=np.float32)])
    result = predict(network, decoder, values, args.model)
    result.update(mapping=args.mapping, experimental=True, seconds=len(capture['rows']) / 2048, calibration='0.2008 µV/count estimate; unverified', sample_rate=2000)
    print(json.dumps({'event': 'result', 'result': result}, allow_nan=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        report(f'{type(exc).__name__}: {exc}')
        sys.exit(1)
