#!/usr/bin/env python3
"""
Prepares downloaded Sketchfab crew bodies for bodyModel.ts (ADR-0026, ADR-0029 crowd variety).

    python3 scripts/prep-crew-glb.py <source.glb> <out.glb>

Needs Pillow (pip install pillow). What it does, without touching the mesh or the skin:
  - Renderpeople rigs (`hip`, `spine_01`, `upperleg_l`, ...): renames the bones the rig mapper would not recognise
    (`hip` -> `Hips`, `spine_0N` -> `SpineN`, `upperleg_*` -> `thigh_*`). Mixamo rigs are left as they are.
  - Drops every texture the game does not use (bodyMaterial.ts reads baseColor and normal only): metallic-roughness,
    occlusion and emissive maps, then any image nothing points at.
  - Re-encodes PNG textures without alpha as JPEG (q88), at most 1024 px. Images with real alpha stay PNG.
  - Drops animations (the game drives the skeleton itself).
"""
import io
import json
import re
import struct
import sys

from PIL import Image

MAX_SIZE = 1024

RENAMES = [
    (re.compile(r'^hip(_\d+)$'), r'Hips\1'),
    (re.compile(r'^spine_0(\d)(_\d+)$'), r'Spine\1\2'),
    (re.compile(r'^upperleg_twist_([lr])(_\d+)$'), r'thigh_twist_\1\2'),
    (re.compile(r'^upperleg_([lr])(_\d+)$'), r'thigh_\1\2'),
]


def read_glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF', 'not a GLB'
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bl = struct.unpack('<I', b[20 + jl:24 + jl])[0]
    binary = b[28 + jl:28 + jl + bl]
    return j, binary


def view_bytes(j, binary, vi):
    bv = j['bufferViews'][vi]
    o = bv.get('byteOffset', 0)
    return binary[o:o + bv['byteLength']]


def main(src, dst):
    j, binary = read_glb(src)
    renamed = 0
    for n in j.get('nodes', []):
        name = n.get('name', '')
        for pat, rep in RENAMES:
            if pat.match(name):
                n['name'] = pat.sub(rep, name)
                renamed += 1
                break
    j.pop('animations', None)

    # Materials keep baseColor + normal only.
    for m in j.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        pbr.pop('metallicRoughnessTexture', None)
        for k in ('occlusionTexture', 'emissiveTexture'):
            m.pop(k, None)
        m.pop('extensions', None)

    used_tex = sorted({
        t['index']
        for m in j.get('materials', [])
        for t in (m.get('pbrMetallicRoughness', {}).get('baseColorTexture'), m.get('normalTexture'))
        if t
    })
    tex_map = {old: new for new, old in enumerate(used_tex)}
    textures = [j['textures'][i] for i in used_tex]
    used_img = sorted({t['source'] for t in textures})
    img_map = {old: new for new, old in enumerate(used_img)}
    for t in textures:
        t['source'] = img_map[t['source']]
    for m in j.get('materials', []):
        for t in (m.get('pbrMetallicRoughness', {}).get('baseColorTexture'), m.get('normalTexture')):
            if t:
                t['index'] = tex_map[t['index']]

    # New image bytes.
    new_images = []
    image_data = []
    for oi in used_img:
        im = j['images'][oi]
        data = view_bytes(j, binary, im['bufferView'])
        pic = Image.open(io.BytesIO(data))
        alpha = pic.mode in ('RGBA', 'LA', 'P') and pic.convert('RGBA').getchannel('A').getextrema()[0] < 250
        if max(pic.size) > MAX_SIZE:
            s = MAX_SIZE / max(pic.size)
            pic = pic.resize((round(pic.size[0] * s), round(pic.size[1] * s)), Image.LANCZOS)
        out = io.BytesIO()
        if alpha:
            pic.convert('RGBA').save(out, 'PNG', optimize=True)
            mime = 'image/png'
        elif im.get('mimeType') == 'image/jpeg' and max(Image.open(io.BytesIO(data)).size) <= MAX_SIZE:
            out.write(data)  # already a small JPEG: keep it as is
            mime = 'image/jpeg'
        else:
            pic.convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
            mime = 'image/jpeg'
        image_data.append(out.getvalue())
        new_images.append({'mimeType': mime})

    # Rebuild the binary chunk: every view an accessor uses, then the kept images.
    acc_views = sorted({a['bufferView'] for a in j.get('accessors', []) if 'bufferView' in a})
    chunks = []
    new_views = []
    view_map = {}
    offset = 0

    def push(data, extra):
        nonlocal offset
        pad = (-offset) % 4
        if pad:
            chunks.append(b'\0' * pad)
            offset += pad
        v = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data), **extra}
        chunks.append(data)
        offset += len(data)
        new_views.append(v)
        return len(new_views) - 1

    for vi in acc_views:
        bv = j['bufferViews'][vi]
        extra = {k: bv[k] for k in ('byteStride', 'target') if k in bv}
        view_map[vi] = push(view_bytes(j, binary, vi), extra)
    for a in j.get('accessors', []):
        if 'bufferView' in a:
            a['bufferView'] = view_map[a['bufferView']]
    for im, data in zip(new_images, image_data):
        im['bufferView'] = push(data, {})

    j['bufferViews'] = new_views
    j['images'] = new_images
    j['textures'] = textures
    if not textures:
        j.pop('textures', None)
        j.pop('images', None)
        j.pop('samplers', None)
    j['buffers'] = [{'byteLength': offset}]
    body = b''.join(chunks)
    body += b'\0' * ((-len(body)) % 4)
    text = json.dumps(j, separators=(',', ':')).encode()
    text += b' ' * ((-len(text)) % 4)
    total = 12 + 8 + len(text) + 8 + len(body)
    with open(dst, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<I', len(text)) + b'JSON' + text)
        f.write(struct.pack('<I', len(body)) + b'BIN\0' + body)
    print(f'{src} -> {dst}: {renamed} bones renamed, {len(new_images)} images, {total // 1024} KB')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
