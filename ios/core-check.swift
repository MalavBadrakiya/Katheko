import Foundation
import JavaScriptCore
let context=JSContext()!
context.exceptionHandler={_,error in fatalError("JavaScriptCore: \(String(describing:error))")}
context.evaluateScript(try String(contentsOfFile:CommandLine.arguments[1],encoding:.utf8))
let result=context.evaluateScript("""
(function(){
 const C=KathekoCore;
 const h={startDate:'2026-01-01',weeklyTarget:4,logs:{'2026-11-02':true}};
 if(C.month(h,'2026-11-14','2026-11-14').goal!==18)throw Error('Monthly target');
 if(C.week(h,'2026-11-14','2026-11-14').goal!==4)throw Error('Weekly target');
 if(C.today('Europe/London').length!==10)throw Error('Account timezone');
 if(C.points(h,'2026-11-14')!==10)throw Error('Points');
 return true;
})();
""")
precondition(result?.toBool()==true)
print("PASS: embedded JavaScriptCore dates, monthly targets, weekly targets and points")

