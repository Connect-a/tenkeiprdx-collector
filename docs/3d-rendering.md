# 3Dモデル描画メモ（確定事項）

天啓パラドクスの3Dキャラモデルを拡張内(three.js r136)で描画・アニメ再生するための確定知見。
実装＝`lib/render/unity-sf.js`（SerializedFile+typetree汎用リーダ）／`lib/render/mesh.js`（Mesh/Texture2D/Material/Avatar/Clip抽出）／`lib/render/anim.js`（`TP_ANIM`＝Avatar骨格＋Mecanimクリップ解読）／`lib/render/model3d.js`（three.js描画）。

## バンドル構成
- **キャラmodelバンドル**＝1 SerializedFile(CAB)。Mesh(43)複数・Material(21)・SkinnedMeshRenderer(137)・Avatar(90)・AnimationClip(74)・GameObject(1)/Transform(4)。テクスチャは**別の materials バンドル**（model側Materialのtexenvは空スタブ）。
- **メッシュ**：body_model / head_model / face_model / bangs_model / eyebrow(s)_model / mouth_model ＋ attachment_N_model（装飾・小道具・武器等）。

## テクスチャ
- 形式は実測4種：DXT5Crunched(29)/DXT5(12)/ARGB4444(2)/RGBA32(4)（+RGBA4444(13)対応）。AssetStudio `Texture2DConverter.cs`と突合済（ARGB4444のチャネル順一致確認）。アイコン内訳＝icon/iconlight/monstericon=29／battleicon/chibiicon/itemicon=ARGB4444(2)。
- **crunch(29)復号**＝`vendor/unitycrn.wasm`（AssetStudio `Texture2DDecoderNative`＋`unitycrunch/crn_decomp.h` を emsdk build・`_scripts/build-unitycrn.bat`）。`tp_unity_get_info`/`tp_unity_unpack_level0`。要点＝①manifest CSP `wasm-unsafe-eval` ②`EXPORTED_RUNTIME_METHODS`に`HEAPU32` ③wrapper単独コンパイル ④`-DNDEBUG`。
- 偽JPEG対策：embedded画像スキャンは`FF D8 FF`必須＋寸法≤8192（メッシュ中の`FF D8`誤検出回避）。
- 材質解決＝model側Material名 → **materialsバンドルの同名Materialの mainTex(`_ColorTex`優先／`_MainTex`/`_BaseMap`無ければ最初のtexenv)** → Texture2D(pathID)。
- **★色テクスチャに alphaTest を掛けない**：body/head_colorのアルファは**トゥーンのマスクチャンネルで不透明度ではない**。alphaTestすると alpha≈0 のbodyが全消しになる（例：カルラ body_color mean alpha=11・レアは頭も）。alphaTestは口の共有アトラスだけ。
- **★wrapMode は `RepeatWrapping`**（Unityデフォルト）：一部キャラのbody mesh UVは**[0,1]外（例 U∈[1,2]・タイリング前提）**。ClampToEdgeだと右端に潰れ服の柄が消える（例：ライサ）。
- `flipY=false`・sRGB。

## スキニング（最適化スケルトン）
- `SkinnedMeshRenderer.m_Bones` は**空**、Transformも僅か。**骨格はAvatar(90)に格納**：`m_AvatarSkeleton.data.m_Node`(親index)＋`m_ID`(ボーンhash)＋`m_TOS`(hash→パス文字列)。DefaultPose/AvatarSkeletonPoseは概ね恒等。
- mesh側：`skinWeight`(ch12)/`skinIndex`(ch13)/`m_BindPose`(逆bind行列・row-major e00..e33)/`m_BoneNameHashes`。
- 配線＝Avatar node毎にTHREE.Bone（親index接続）→ mesh毎に `THREE.Skeleton(bones, boneInverses)`（bones=boneNameHashes→Bone、boneInverses=bindposeを`Matrix4.set()`＝row-major）→ `SkinnedMesh`。
- **★最重要ハマり**：`skinnedMesh.bind(skeleton, new THREE.Matrix4())` と**明示的にidentity bindMatrixを渡す**。省略するとr136の`bind()`が`skeleton.calculateInverses()`を呼び、bind時点のrest（=DefaultPose恒等）で boneInverses を identity に上書き → **モデルが原点へ破裂**。
- **★BlendIndices(ch13)のみでBlendWeight(ch12)が無いメッシュに注意**：口(mouth)等は**1頂点1ボーン・weight暗黙1.0**でch13だけ持ちch12が無い(dim0)。両チャネル必須にすると剛体フォールバックで**全頂点をbone0(=BodyCenter)に誤バインド→アニメで頭と分離して口が宙に浮く**(アイトリア/エミリー等で発覚)。修正＝**ch13があればweightはch12が有ればそれ・無ければ先頭influenceに1.0**。実データでmouthのch13は全頂点=index5(Headボーン)。
- 真にskin channelが皆無のメッシュのみ skinIndex=0/weight=1 を合成(剛体)。
- root/mesh を原点(identity)に置けば bindMatrix=identity で整合。
- **★座標系＝Unity(左手系)→three(右手系)で鏡写しになる**：Unity頂点/ボーンを素で読むと**モデルが左右反転**（ゲームと鏡像・武器や編み込みの左右で発覚）。対策＝**カメラのprojection行列のX成分を反転**（`updateProjectionMatrix`をラップしm00を×-1）＝画面レベルで一律に1回だけ反転→スキンメッシュ・ボーン装着武器とも整合、view空間ライティングは不変。DoubleSide材質で反転ワインディングでも面は見える。（旧「変換不要」は誤り）

## アニメーション（Mecanim汎用クリップ）
- クリップは humanoid でなく **generic**（`m_MuscleClip.m_Clip.data` に StreamedClip/DenseClip/ConstantClip、`m_ClipBindingConstant.genericBindings`）。`m_RotationCurves`等は空。
- **カーブ割当**：genericBindings を順に走査し、Transform(typeID=4)の attribute で消費カーブ数＝position(1)3/rotation(2)4/scale(3)3。グローバルカーブindex＝ streamed[0..streamCount) → dense → constant の順。総カーブ数＝streamed+dense+const＝binding総和で検証可。
- **StreamedClip**＝uint配列を `{time, keys[{index, coeff[4]}]}` にパース。値は cubic：`v(dt)=((c0*dt+c1)*dt+c2)*dt+c3`（先頭/末尾に ±FLT_MAX センチネルframe）。**DenseClip**＝frame×curveの一様サンプル。**ConstantClip**＝定数。
- per-boneに pos/rot/scale をまとめ、固定fpsでリサンプル→THREE KeyframeTrack（Vector/Quaternion）。ボーン名＝`b<hash>`。AnimationMixerで再生。
- **★回転は半球連続性を強制**：リサンプルした連続quaternionの dot<0 なら符号反転（でないとslerpが長経路→180°反転/ガクつき）。
- **★リサンプルは60fps**：three側は隣接キーフレーム間を線形/slerp補間するので、リサンプルが粗いと速いクリップで面取り。30fpsだと速いクリップで最大~21°/フレームの回転ステップ→60fpsで半減。異常値(NaN/Inf)無し・1フレームスパイク(cubicオーバーシュート)無し。
- **カーブ割当は検証済で正常**：回転は全クリップで生マグニチュード≈1（別カーブ誤参照なら壊れる）、streamed keyのindexは[0,streamCount)を過不足なく占有＝binding start(累積curveSize)と境界整合。∴「位置制御が別カーブを参照」ではない。
- **ループのガクつき＝未解決（対策を全撤去してクリーン化・再考予定）**：現状`playClip`は選択クリップを`LoopRepeat`で単純再生するだけ。**一発演出(CastingSpell/Skill/Victory)は末尾ポーズ≠先頭ポーズ**(実測CastingSpell pos差4.5/rot差88.8)なので毎ループ末尾→先頭にスナップ＝全体が傾いてガクッ、が残る。過去に試して撤去した対策＝①自己crossFadeTo(0.3sの速い巻き戻しに見え不十分)②「演出→Idle→静止→再演出」＋手動weightフェード(挙動は良いが複雑・`crossFadeTo`のスケジュールweightはaction再利用でweight0固着=T-pose化した)。**再考の土台に戻した**。次案＝ゲームのライブ挙動を観測して演出→Idle遷移を実タイミングで模倣。
- **棒立ちポーズ(`restPose`)**：モーション選択の最後「⊂二二二( ^ω^)二⊃ブーン」＝`mixer.stopAllAction()`＋各ボーンをDefaultPose(rest)へ戻す。アニメ停止時はloopで`mixer.update`を呼ばずボーンをrestに保つ。

## 口＝共有表情アトラス
- **mat_mouth は全キャラ両バンドルでテクスチャ無し**。共有 `materialsbundles_assets_assets/mouthmaterials_*.bundle` の `mouth_texture_preset`（**5×5の口表情アトラス**）を全キャラ共通で使う。fanged/shark/secondary も同梱。
- 口mesh のデフォルトUVは**空セル**を指す（ゲームはランタイムでUVオフセットして表情セルを選ぶ）。`remapMouthUV(col,row)`＝セル移動のプレーンtranslate（V反転・位置補正なし）。口セレクタで表情切替。セル名（確認済ラベル）＝1:ムッ/2:あっ/5:ニヤッ/8:うにっ/10:むー（`MOUTH_EXPRESSIONS`は全10件維持）。
- 取得＝**手動DL**：`collection.readMouthAtlas()`（読み取り専用）で `_共有リソース/3d/mouthmaterials.bundle` を読む。無ければ image-panel が3Dビューア上部に案内バー＋「口アトラスをDL」ボタンを出し、押下で `collection.downloadMouthAtlas()`（index or `3dModels_catalog.json`直読みで rel特定→CDN取得→保存）→再描画。自動DLはしない（挙動を単純化）。アトラス無時は口メッシュ非表示（ベタ塗り回避）。

## 目/眉の表情＝ブレンドシェイプ（実装済）
- **m_Shapes 構造**：`vertices`(BlendShapeVertex[]:`{vertex:{x,y,z},normal,tangent,index}`)＋`shapes`(フレーム:`{firstVertex,vertexCount,hasNormals,hasTangents}`)＋`channels`(`{name,nameHash,frameIndex,frameCount}`)＋`fullWeights`。全チャネル frameCount=1。頂点デルタは実測 max約0.05〜0.08(モデル単位)。
- **実チャネル名（実測・旧ドキュメントの`eyes_01`等は誤り）**：face_model=16ch＝`face.face_{idle2,damage,victory1,victory2,victory3,SPskill1,SPskill2,Anomaly}` ×`_R/_L`。eyebrows_model=18ch＝`eyebrow.eyebrows_{attack1,attack2,attack3,damage,Anomaly,victory2,SPskill1,SPskill2,Anomaly1}` ×`_R/_L`。表情は**左右(_R/_L)半分に分割**＝1表情＝両半分。
- **モーションクリップはブレンドシェイプを駆動しない**（全てTransformカーブ）＝ゲームコードが戦闘状態でweightをセット。∴デフォルトは全weight=0の中立顔。
- **表情の「呼び出し名」＝バンドル内のblendshapeチャネル名のみ**（idle2/damage/victory/attack/SPskill/Anomaly 等の戦闘状態名、またはキャラにより数値`eyes_05`/`eyebrow_06`）。**masterに表示名テーブルは無い**（マスタ全文検索でこれらの語ヒット0）。scene[30]表情は2D立ち絵Spine用で3Dブレンドシェイプとは別系統。∴UIは数値ラベル(0=中立)を採用（base名表示に切替は容易）。
- **実装**：`mesh.js extractMeshGeometry` が `m_Shapes` を per-channel 頂点デルタ(`blendShapes[{name,deltas:Float32Array(vcount*3)}]`)に展開。`model3d.js` が geo.morphAttributes.position＋`morphTargetsRelative=true`(deltas)→ Mesh構築で influences/dictionary生成。表情セレクタ「目(face)」「眉(brow)」＝base名(末尾`_R/_L`除去)でグループ化、選択で該当base全チャネルの influence=1・他0。「中立」で全0。

## 立ち絵Spine（3Dとは別系統・確定）
- atlas/skel は**ファイルでなくCAB内のTextAsset(classID49)**＝`decode.js extractTextAssets()`で抽出。テクスチャは同バンドルTexture2Dをcrunch→RGBA。**公式Spine Web Player 3.8**へrawページ供給。
- **premultipliedAlpha=true 必須**（Unity書き出しはPMA。falseだと加算ブレンドのほっぺ等が二重減衰で消える）。
- **★error コールバックは `(player, error)` の2引数**（spine-player3.8 `showError`→`config.error(this, error)`）。第1引数は**playerインスタンス＝循環参照**。これを message 扱いして`JSON.stringify`すると "Converting circular structure to JSON" で自爆し、しかも playerErr ガードを立てる前に落ちるので**毎フレーム再発＝コンソールが同一エラーで数万行に膨張**（10094403_01で発覚）。正しくは第2引数(`err`)を使う。＋失敗時は`player.dispose()`でリトライループ(loadSkeleton毎フレーム再試行)を止める。
- **★非ASCIIリージョン名のskelが "could not load skeleton .skel"（region未検出）で落ちる＝2つの根治**（10094403_01の`hair_」shadow_5`で発覚）:
  1. **vendor spine-player3.8 `readString` のUTF-8デコードが `readByte`(＝`getInt8`,符号付き)由来で化ける**。マルチバイト先頭(例0xE3=-29)で `b>>4` が負→UTF-8分岐(case12/13/14)に入らずdefaultの`String.fromCharCode(負)`＝`U+FF00+b`の化け(`￣ﾀﾍ`)。→**修正は readString 内で `var b = this.readByte() & 0xFF;` の1点だけ**（局所マスク）。★`readByte`自体を`getUint8`にグローバル変更すると**メッシュ/deformパースが崩れ立ち絵の腕がグニョングニョンになる**回帰が出た（例カルラ10422405 spine/spinelight）＝readByteは符号付きのまま維持が必須。globalな変更はしないこと。
  2. **visual.js が atlas текстを `latin1` デコード**＝日本語リージョン名が化けてskel側(正UTF-8)と不一致。→`utf8`デコードに変更（`scaleAtlasCoords`内とatlasText→Blobの両方）。skel側(readByte修正)とatlas側(UTF-8)の両方が揃って初めて名前一致→region解決。ASCII名のみのキャラは元から無事だった。
- キャラ配下の全Spineを列挙(`collectOwnSpineEntries`)。画像解決は`TP_MESH.decodePrimaryTexture`(正式SFパース)を第一手段。
- **★解決＝CAB内のみ（フォールバック撤去・2026-07-17）**：このゲームの atlas/skel/テクスチャは**全てCAB内**（atlas/skel=TextAsset49・テクスチャ=Texture2D28）。`tryBuildPlayableSpineFromBundle` は **atlas/skel=`extractTextAssets`、テクスチャ=`decodePrimaryTexture`（＋crunch）だけ**を使う。旧「UnityFSノード→外部FS解決→他バンドルmetascan」は**このゲームでは常に空振りの死にコード**だったので**完全削除**（未リリースゆえ後方互換不要）。関連ヘルパ(resolveResourceFromFs/resolveResourceByMetaScan/scanSpineRefsFromBundleText/candidateResourcePaths/nodeBytesByPath等)も撤去。取れなければ `atlas-skeleton-missing`／`texture-missing` を返すだけ。
- **`visual/still` の2種**：①`visual/cg_bg/<id>_NN_still_MM`＝CG画像(atlas無・scene参照)／②`visual/still/<id>_NN`(assets.still)＝Spine立ち絵(atlas 4096²リグ)。
- **Spineパーツ間の線(seam)＝解消(要実機確認)**：主因＝`still`は atlas宣言`size:`(例4096²)と復号テクスチャ(2048²)が食い違い、以前は供給前に`drawImage`で atlas size へ**拡大**していた。拡大バイリニア補間＋表示縮小フィルタが領域境界を跨いで隣パーツ色をにじませ、口周り等に seam が出ていた（最近傍拡大でも表示縮小分のにじみが薄く残った）。
  - **対策(現行)**：**テクスチャは拡大せず native のまま供給**し、`scaleAtlasCoords()` で atlas の全座標(`size`/`xy`/`orig`/`offset`)を実テクスチャ寸法へ一括スケール。UVは`coord/size`の正規化なので数学的に等価かつtexel厳密＝**ゲーム本体と同じnative解像度・native座標のサンプリングを再現**し、拡大補間も過剰縮小も無くなる。※spine/spinelightは2048²一致でスケール不要＝無影響、対象はstillのみ。旧「native供給でぐちゃぐちゃ」は`size:`を4096のまま2048テクスチャを貼った不整合が原因で、座標も同時スケールする本方式とは別物。

## メッシュ表示トグル
- 分類＝base(body/head/face/hair/mouth・常時表示)／outfit(attachment＋mat_body/head かつ多ボーン＝翼/マント・表示)／weapon(装備武器・表示)／prop(attachment＋mat_attachment or 少ボーン＝旗/プレゼント/エフェクト・**既定非表示**＝ゲームがidleで出さない小道具)。
- `本体／装飾／武器／小物` チェックボックスで切替。

## 服装（材質バリアント）切替
- キャラの材質バリアント（`characters/<id>/<variation>_*.bundle`）は buildPack が全variation DL済み→`meta.assets.materials[variation]`。**2つ以上ある時だけmodel3dのコントロールバーに「服装」ドロップダウン**を出す。材質バンドルの再読込はディスクアクセス（caller側）なので`options.costume.onChange`コールバックで image-panel が別variationを読み直して再render（メッシュ共通・テクスチャ差替）。
- ★実態＝ロスターで複数variationは**2体のみ**(10106402=属性9種／10094403=default/default_g)。大半の別衣装は**別キャラID**でモデル内切替ではない。

## シェーディング（トゥーン近似）
- **★重要＝色テクスチャは既に"トゥーン塗り"（陰影焼き込み済）**。∴シーンライティングの陰影を上掛けすると暗く沈む（`MeshToonMaterial`だと全身が暗いシルエットになった＝失敗）。正解は**アンリットでテクスチャそのまま＋輪郭線**。
- `options.shading.mode`＝`'unlit'`(既定)/`'toon'`/`'pbr'`。`getMat`：**toon・unlit=`MeshBasicMaterial`（アンリット＝テクスチャ全面フル輝度）／pbr=`MeshStandardMaterial`（ソフト陰影・従来）**。texCacheキーはmode込み。
- **輪郭線＝インバーテッドハル**：`makeOutline`＝法線方向に`radius*0.0025`(`OUTLINE_THICK`)押し出した黒`MeshBasicMaterial`コピー。skinnedは同一skeletonでbind(identity)＝アニメ追従。base/outfitメッシュのみ(口/prop除外)。同じmeshGroupに入れトグルで一緒に隠れる。**toonモード時のみ生成**(unlitは輪郭無し)。
  - **★side=`FrontSide`（通常のインバーテッドハルはBackSideだが逆）**：カメラのprojection X反転(鏡写し補正)でワインディングが反転しているため。BackSideのままだと拡大した黒ハルの手前面が描かれ**全身が真っ黒**になる（実際にハマった）。
- 武器もtoon/unlitでは`MeshBasicMaterial`(pbr時のみStandard)。
- 「描画」ドロップダウンで切替(`options.shading.onChange`→image-panelが再render)。`S._shading`はキャラ横断で保持。差＝toon(アンリット＋輪郭)/unlit(アンリット)/pbr(陰影)。リムライト未実装。

## カメラ・UI
- 左ドラッグ=回転・右/中ドラッグ=パン・ホイール=ズーム。イメージタブを開くと自動描画（ローディングスピナー付き）。
- **全画面**：コントロールバーの「⛶」＝Fullscreen APIで**3Dホストごと全画面**（コントロールも残る）。`fullscreenchange`でrendererをhostサイズにリサイズ＋camera.aspect更新（projection X反転ラッパ維持）。dispose時にlistener解除＋全画面解除。画像側はvisual.jsのオーバーレイ式(静止画lightbox)＝別実装。
- コントロールバーは`flex-wrap`。「描画」の直前に全幅ブレーク要素を入れ、**モーション/口/目/眉=1段目、描画/服装/表示トグル=2段目**に折り返す。

## 武器（装備品・実装済）
- 武器は**別3Dバンドル**（例：迦楼羅=`3dmodels_assets_3dmodels/40042201_*.bundle` ＋ `materialsbundles_assets_assets/3dmodels/weapons/<weaponId>/<variation>_*.bundle`）＝**静的メッシュ(ボーン無)1個＋mat_weapon**（テクスチャ`weapon_<id>_color_texture`は材質バンドル側）。
- **キャラ→武器のリンク＝キャラマスタ(tag4)の field[8] に JSON文字列で直接**（旧「`5010421`→武器マスタ表」説は誤り＝5010421は靴/槍アイテムの別ID）。形式：`[{"Slot":"wp_2","WeaponId":"40042201","AssetConfiguration":{"Variation":"Default","Scale":1}}]`。実測 375/408体が武器持ち・二刀(wp_2+wp_1)は73体。
- **装着ボーン**：Slot(`wp_2`/`wp_1`)→ Avatar TOS のパス末尾一致（`.../Hand_R/Weapon_R/wp_2`＝hash 401071608 ／`.../Hand_L/Weapon_L/wp_1`）→ 該当THREE.Boneへ武器メッシュを親子付け。ボーンはdefPose＋idleアニメで駆動＝武器が追従。
- **★装着変換＝武器バンドルのルートGameObject の local transform を適用（identityは誤り）**：全武器の root(father=0)は **rot=[0,1,0,0]＝Y軸180°回転**（pos0/scale1）。これを武器メッシュに適用しないと**逆向き/位置ズレ**（例フォウの日傘が手から外れる）。＋AssetConfiguration.Scaleを乗算。
- **DL**：`assetIndex[weaponId]`（weaponIdはheroSet入り＝pseudo-hero）に model/materials が入る。∴キャラの自前asset jobsには**含まれない**（キャラIDと武器IDが別）→ buildPack が det.weapons を見て別途 `visual/weapon/<id>_model.bundle`＋`_mat.bundle` へDL、`meta.assets.weapon[id]={model,materials,slot,scale}` を記録。
- **描画**：image-panel が武器バンドルをparse→`render(...,{weapons:[{model,materials,slot,scale}]})`。model3d が武器メッシュをボーンに装着し「武器」トグル群(既定表示)へ。
- **注意**：既存DL済みキャラのmetaには`assets.weapon`が無い＝**索引再生成＋再DLが必要**。
