# -*- coding: utf-8 -*-
import json
from geographiclib.geodesic import Geodesic

pairs = [
  ("equator-1deg",        (0,0),(0,1)),
  ("flinders-buninyong",  (-37.95103342,144.42486789),(-37.65282114,143.92652151)),
  ("uk-north",            (50.0359,-5.4253),(58.3838,-3.0412)),
  ("sample-S001",         (31.16666667,121.25),(31.5,121.2)),
  ("sydney-melbourne",    (-33.8688,151.2093),(-37.8136,144.9631)),
  ("reykjavik-svalbard",  (64.1466,-21.9426),(78.2232,15.6469)),
  ("nairobi-singapore",   (-1.2864,36.8172),(1.3549,103.8230)),
  ("nyc-london",          (40.7128,-74.0060),(51.5074,-0.1278)),
  ("buenosaires-paris",   (-34.6037,-58.3816),(48.8566,2.3522)),
  ("tokyo-hongkong",      (35.6762,139.6503),(22.3193,114.1694)),
]
g = Geodesic.WGS84
refs = []
for name, a, b in pairs:
    line = g.Inverse(a[0],a[1],b[0],b[1])
    refs.append({"name":name,"a":{"lat":a[0],"lon":a[1]},"b":{"lat":b[0],"lon":b[1]},"s12":line["s12"]})
with open("_geo_refs.json","w",encoding="utf-8") as f:
    json.dump(refs,f,ensure_ascii=False,indent=1)
print("flinders:", round(refs[1]["s12"],3), "(expect 54972.271)")
