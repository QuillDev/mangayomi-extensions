import '../../model/source.dart';
import 'multisrc/datalifeengine/sources.dart';
import 'src/de/animetoast/source.dart';
import 'src/en/animepahe/source.dart';
import 'src/en/kisskh/source.dart';
import 'src/es/animeonlineninja/source.dart';
import 'src/fr/franime/source.dart';
import 'src/id/otakudesu/source.dart';

List<Source> dartAnimesourceList = [
  franimeSource,
  otakudesu,
  ...datalifeengineSourcesList,
  animepaheSource,
  animetoast,
  animeonlineninjaSource,
  kisskhSource,
];
