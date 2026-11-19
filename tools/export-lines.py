"""선 추출 AI(MangaLineExtraction, MIT)의 구조를 도트메이커용 ONNX로 바꾼다.

만드는 것(기본 src/ 폴더):
- lines-graph.onnx: 구조만. 가중치는 외부 데이터 'weights.bin'을 가리킨다(입력 image [1,1,h,w] 0~255 회색 → 출력 lines [1,1,h,w]).
- lines-manifest.json: [safetensors 키, weights.bin 안 위치(바이트), Float32 개수] 목록.
프로그램은 허깅페이스 원본 가중치(BF16 model.safetensors)를 받아 이 목록대로 Float32로 풀어 weights.bin으로 넘긴다(src/ai.js).

필요: torch, transformers 4.x(5.x는 모델 코드가 쓰는 transformers.onnx가 없어 못 읽음), onnx
지금 파일은 torch 2.15.0 · transformers 4.57.6 · onnx 1.23.2로 만들면 바이트까지 같게 나온다(2026-11-18 확인).
사용: python3 tools/export-lines.py [출력 폴더]
"""
import json
import struct
import sys
from pathlib import Path

import onnx
import torch
from huggingface_hub import hf_hub_download
from transformers import AutoModel

REPO = "p1atdev/MangaLineExtraction-hf"
REVISION = "3c815256f6f9be1ead162e8caaee63b489731d00"  # src/files.js의 model.safetensors 주소와 같은 판


def safetensors_header(path):
    """safetensors 앞머리(키마다 dtype·shape·위치)만 읽는다."""
    with open(path, "rb") as file:
        length = struct.unpack("<Q", file.read(8))[0]
        return json.loads(file.read(length))


def main(out):
    out.mkdir(parents=True, exist_ok=True)
    model = AutoModel.from_pretrained(REPO, revision=REVISION, trust_remote_code=True, dtype=torch.float32)
    network = model.model.eval()  # 후처리(자르기·0~255로 묶기)는 프로그램이 한다

    graph_path = out / "lines-graph.onnx"
    torch.onnx.export(
        network, torch.full((1, 1, 64, 64), 255.0), graph_path,
        input_names=["image"], output_names=["lines"],
        dynamic_axes={"image": {2: "h", 3: "w"}, "lines": {2: "h", 3: "w"}},
        opset_version=17, do_constant_folding=False, dynamo=False,
    )

    # 가중치를 모두 외부 데이터 하나(weights.bin)에 빈틈없이 이어 붙인 것으로 바꾸고, 그 위치를 목록으로 남긴다.
    graph = onnx.load(graph_path)
    header = safetensors_header(hf_hub_download(REPO, "model.safetensors", revision=REVISION))
    manifest, offset = [], 0
    for tensor in graph.graph.initializer:
        count = len(onnx.numpy_helper.to_array(tensor).reshape(-1))
        key = "model." + tensor.name
        info = header.get(key)
        if info is None or info["dtype"] != "BF16" or count != max(1, int(torch.tensor(info["shape"]).prod())):
            raise SystemExit(f"원본 가중치와 맞지 않는 항목: {key}")
        tensor.ClearField("raw_data")
        tensor.ClearField("float_data")
        tensor.data_location = onnx.TensorProto.EXTERNAL
        del tensor.external_data[:]
        for name, value in (("location", "weights.bin"), ("offset", str(offset)), ("length", str(count * 4))):
            entry = tensor.external_data.add()
            entry.key, entry.value = name, value
        manifest.append([key, offset, count])
        offset += count * 4
    onnx.save(graph, graph_path)
    (out / "lines-manifest.json").write_text(json.dumps(manifest))
    print(f"{graph_path} {graph_path.stat().st_size} bytes, 가중치 {len(manifest)}개 ({offset} bytes)")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "src"))
