import '../../model/source.dart';
import 'multisrc/datalifeengine/sources.dart';
import 'src/all/animeworldindia/sources.dart';
import 'src/ar/okanime/source.dart';
import 'src/de/animetoast/source.dart';
import 'src/en/animepahe/source.dart';
import 'src/en/kisskh/source.dart';
import 'src/es/animeonlineninja/source.dart';
import 'src/fr/animesama/source.dart';
import 'src/hi/yomovies/source.dart';
import 'src/fr/animesultra/source.dart';
import 'src/fr/franime/source.dart';
import 'src/id/nimegami/source.dart';
import 'src/id/otakudesu/source.dart';
import 'src/it/animesaturn/source.dart';

List<Source> dartAnimesourceList = [
  franimeSource,
  animesultraSource,
  okanimeSource,
  otakudesu,
  nimegami,
  animesaturn,
  ...datalifeengineSourcesList,
  yomoviesSource,
  animesamaSource,
  ...animeworldindiaSourcesList,
  animepaheSource,
  animetoast,
  animeonlineninjaSource,
  kisskhSource,
];
