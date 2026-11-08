# 把繁體介面字串轉成简体（台灣用語轉大陸用語）。需要：pip install opencc-python-reimplemented
import json
import sys

from opencc import OpenCC

cc = OpenCC('tw2sp')
FIX = {'㐷': '马', '伡': '车', '傌': '马', '俥': '车', '帥': '帅', '砲': '炮', '马／马': '马', '车／车': '车', '炮／炮': '炮', '拖曳': '拖动', '发送': '传送', '直在线': '直线上'}

src = json.load(open(sys.argv[1], encoding='utf8'))
out = {}
for k, v in src.items():
    s = cc.convert(v)
    for a, b in FIX.items():
        s = s.replace(a, b)
    out[k] = s
json.dump(out, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False)
