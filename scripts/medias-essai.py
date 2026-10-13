#!/usr/bin/env python3
"""Fabrique les médias d'essai du lot 1 (public/test-medias/) : deux photos de scène,
un visuel et deux vidéos H.264 1080p 30 i/s au format recommandé, avec leur image fixe.
Usage : python3 scripts/medias-essai.py  (demande Pillow et ffmpeg)."""
import math, os, random, subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, '..', 'public', 'test-medias')
W, H = 1920, 1080
GRAS = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'


def scene(nom, fond, faisceaux, graine):
    random.seed(graine)
    img = Image.new('RGB', (W, H), fond)
    lum = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(lum)
    for i, coul in enumerate(faisceaux * 2):
        x = 160 + i * (W - 320) / (len(faisceaux) * 2 - 1)
        angle = random.uniform(-0.55, 0.55)
        larg = random.uniform(90, 170)
        bas = (x + math.sin(angle) * 1300, H + 80)
        d.polygon([(x - 8, -10), (x + 8, -10), (bas[0] + larg, bas[1]), (bas[0] - larg, bas[1])], fill=coul)
    lum = lum.filter(ImageFilter.GaussianBlur(28))
    halo = Image.new('RGB', (W, H), (0, 0, 0))
    dh = ImageDraw.Draw(halo)
    for coul in faisceaux:
        cx, cy, r = random.randint(200, W - 200), random.randint(80, 420), random.randint(140, 260)
        dh.ellipse((cx - r, cy - r, cx + r, cy + r), fill=coul)
    halo = halo.filter(ImageFilter.GaussianBlur(120))
    img = Image.composite(lum, img, lum.convert('L').point(lambda v: min(255, int(v * 0.9))))
    img = Image.blend(img, halo, 0.35)
    # public en ombres chinoises
    foule = Image.new('L', (W, H), 0)
    df = ImageDraw.Draw(foule)
    x = -40
    while x < W + 40:
        r = random.randint(34, 52)
        y = H - random.randint(70, 150)
        df.ellipse((x - r, y - r, x + r, y + r), fill=255)
        df.rectangle((x - r * 1.6, y + r * 0.6, x + r * 1.6, H), fill=255)
        if random.random() < 0.28:
            bx = x + random.randint(-30, 30)
            df.line((x + r * 0.8, y + r, bx + random.randint(-60, 60), y - random.randint(180, 300)), fill=255, width=26)
        x += random.randint(70, 120)
    img.paste((4, 3, 8), mask=foule.filter(ImageFilter.GaussianBlur(2)))
    grain = Image.effect_noise((W, H), 18).convert('RGB')
    img = Image.blend(img, grain, 0.05)
    img.save(os.path.join(SORTIE, nom), quality=86, optimize=True, progressive=True)


def visuel(nom):
    img = Image.new('RGB', (W, H))
    px = img.load()
    a, b, c = (0xc2, 0x3d, 0x97), (0xa9, 0x4f, 0xd6), (0x8e, 0x63, 0xff)
    for x in range(W):
        t = x / (W - 1)
        coul = tuple(int(a[i] + (b[i] - a[i]) * t / 0.55) if t < 0.55 else int(b[i] + (c[i] - b[i]) * (t - 0.55) / 0.45) for i in range(3))
        for y in range(H):
            px[x, y] = coul
    d = ImageDraw.Draw(img)
    for i in range(0, W + H, 46):
        d.line((i, 0, i - H, H), fill=(255, 255, 255), width=2)
    img = Image.blend(Image.new('RGB', (W, H), (255, 255, 255)), img, 0.92)
    d = ImageDraw.Draw(img)
    grand = ImageFont.truetype(GRAS, 210)
    moyen = ImageFont.truetype(GRAS, 54)
    d.text((120, 300), "VISUEL", font=grand, fill=(255, 255, 255))
    d.text((120, 520), "D'ESSAI", font=grand, fill=(255, 255, 255))
    d.text((126, 800), "Image importée · 1920 × 1080 px", font=moyen, fill=(255, 255, 255))
    d.rectangle((0, H - 24, W, H), fill=(0, 0, 0))
    img.save(os.path.join(SORTIE, nom), quality=88, optimize=True, progressive=True)


def video(nom, lettre, c0, c1):
    chemin = os.path.join(SORTIE, nom + '.mp4')
    texte = "VIDÉO D’ESSAI " + lettre
    filtre = (
        "[0:v][1:v]overlay=x='mod(t*480,2120)-200':y=830,"
        "drawtext=fontfile=" + GRAS + ":text='" + texte + "':fontcolor=white:fontsize=150:x=(w-text_w)/2:y=330,"
        "drawtext=fontfile=" + GRAS + ":text='%{eif\\:n\\:d}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=560,"
        "format=yuv420p[v]"
    )
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'lavfi',
        '-i', 'gradients=s=1920x1080:c0=%s:c1=%s:x0=0:y0=0:x1=1920:y1=1080:speed=0.015:rate=30:duration=8' % (c0, c1),
        '-f', 'lavfi', '-i', 'color=c=white:s=200x24:r=30:d=8',
        '-filter_complex', filtre, '-map', '[v]',
        '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-b:v', '5M', '-maxrate', '6M', '-bufsize', '10M',
        '-r', '30', '-movflags', '+faststart', chemin], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', chemin, '-frames:v', '1', '-q:v', '3',
                    os.path.join(SORTIE, nom + '.jpg')], check=True)


if __name__ == '__main__':
    os.makedirs(SORTIE, exist_ok=True)
    scene('photo-soiree-1.jpg', (8, 5, 16), [(194, 61, 151), (142, 99, 255), (90, 160, 255)], 7)
    scene('photo-soiree-2.jpg', (14, 6, 4), [(255, 140, 40), (230, 40, 60), (255, 200, 90)], 11)
    visuel('visuel-essai.jpg')
    video('video-essai-a', 'A', '0x8e63ff', '0x1b1030')
    video('video-essai-b', 'B', '0xc23d97', '0x2a0c1e')
    for f in sorted(os.listdir(SORTIE)):
        print(f, os.path.getsize(os.path.join(SORTIE, f)))
