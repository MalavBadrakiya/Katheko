import SwiftUI
import JavaScriptCore
import Security
import UniformTypeIdentifiers

// V2 deliberately preserves the entire JSON document, including legacy fields.
typealias JSON = [String: Any]
extension Dictionary where Key == String, Value == Any {
    func text(_ key: String) -> String { self[key] as? String ?? "" }
    func number(_ key: String) -> Int { (self[key] as? NSNumber)?.intValue ?? 0 }
    func flag(_ key: String) -> Bool { self[key] as? Bool ?? false }
    func object(_ key: String) -> JSON { self[key] as? JSON ?? [:] }
    func rows(_ key: String) -> [JSON] { self[key] as? [JSON] ?? [] }
}
struct AppFailure: LocalizedError { let message: String; var errorDescription: String? { message } }

enum SecureSession {
    static let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,
        kSecAttrService as String:"KathekoV2", kSecAttrAccount as String:"supabase-session"]
    static func load() -> Data? {
        var q=query; q[kSecReturnData as String]=true; q[kSecMatchLimit as String]=kSecMatchLimitOne
        var result: CFTypeRef?; guard SecItemCopyMatching(q as CFDictionary,&result)==errSecSuccess else { return nil }
        return result as? Data
    }
    static func save(_ data: Data) throws {
        let status=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if status==errSecItemNotFound {
            var q=query; q[kSecValueData as String]=data
            q[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(q as CFDictionary,nil)==errSecSuccess else { throw AppFailure(message:"Could not securely save your session.") }
        } else if status != errSecSuccess { throw AppFailure(message:"Could not update your secure session.") }
    }
    static func clear() { SecItemDelete(query as CFDictionary) }
}

@MainActor final class Store: ObservableObject {
    @Published var state: JSON?; @Published var social: JSON=[:]
    @Published var busy=false; @Published var message: String?; @Published var ready=false
    @Published var user: JSON=[:]
    private var session: JSON=[:]; private var revision: String?
    private var refreshTask: Task<Void, Error>?
    let core: JSContext
    let config: JSON
    var uid: String { user.text("id") }
    var habits: [JSON] { state?.rows("habits") ?? [] }
    var today: String { call("today",[state?.text("timezone").isEmpty == false ? state!.text("timezone") : "Europe/London"])?.toString() ?? "" }
    var points: Int { habits.reduce(0) { $0 + Int(call("points",[$1,today])?.toInt32() ?? 0) } }
    init() {
        guard let ctx=JSContext(), let coreURL=Bundle.main.url(forResource:"v2-core",withExtension:"js"),
              let source=try? String(contentsOf:coreURL,encoding:.utf8),
              let configURL=Bundle.main.url(forResource:"Backend",withExtension:"json"),
              let data=try? Data(contentsOf:configURL), let conf=(try? JSONSerialization.jsonObject(with:data)) as? JSON else {
            fatalError("Missing bundled Katheko resources. Run prepare-ios.cjs before building.")
        }
        core=ctx; config=conf; ctx.evaluateScript(source)
    }
    func call(_ function: String,_ args: [Any]) -> JSValue? {
        core.objectForKeyedSubscript("KathekoCore")?.objectForKeyedSubscript(function)?.call(withArguments:args)
    }
    func metric(_ h: JSON,_ date: String,_ mode: String) -> JSON { call(mode == "month" ? "month" : "week",[h,date,today])?.toDictionary() as? JSON ?? [:] }
    func add(_ date: String,_ days: Int) -> String { call("add",[date,days])!.toString() }
    func monday(_ date: String) -> String { call("monday",[date])!.toString() }
    func days(_ start: String,_ end: String) -> [String] { call("dates",[start,end])?.toArray() as? [String] ?? [] }
    func range(_ date: String,_ mode: String) -> (String,String) {
        if mode == "day" { return (date,date) }
        if mode == "week" { let a=monday(date); return (a,add(a,6)) }
        let m=metric(["startDate":"2000-01-01","weeklyTarget":1,"logs":[:]],date,"month")
        return (m.text("start"),m.text("end"))
    }
    func shift(_ date: String,_ mode: String,_ direction: Int) -> String {
        if mode != "month" { return min(today,add(date,direction*(mode == "week" ? 7 : 1))) }
        let r=range(date,"month"); return min(today,direction < 0 ? add(r.0,-1) : add(r.1,1))
    }
    func request(_ path: String, method: String="POST", body: JSON?=nil, authenticated: Bool=true) async throws -> Any {
        if authenticated { try await refreshSession() }
        guard let url=URL(string:config.text("url")+path) else { throw AppFailure(message:"Invalid backend configuration.") }
        var req=URLRequest(url:url); req.httpMethod=method; req.timeoutInterval=30
        req.setValue(config.text("key"),forHTTPHeaderField:"apikey")
        req.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if authenticated { req.setValue("Bearer "+session.text("access_token"),forHTTPHeaderField:"Authorization") }
        if let body { req.httpBody=try JSONSerialization.data(withJSONObject:body) }
        let (data,response)=try await URLSession.shared.data(for:req)
        let value=(try? JSONSerialization.jsonObject(with:data,options:.fragmentsAllowed)) ?? NSNull()
        guard let http=response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let error=value as? JSON ?? [:]
            throw AppFailure(message:error.text("msg").isEmpty ? (error.text("message").isEmpty ? error.text("error_description") : error.text("message")) : error.text("msg"))
        }
        return value
    }
    private func setSession(_ value: JSON) throws {
        var updated=value
        if updated["expires_at"] == nil { updated["expires_at"]=Date().timeIntervalSince1970+Double(value.number("expires_in")) }
        try SecureSession.save(JSONSerialization.data(withJSONObject:updated)); session=updated; user=value.object("user")
    }
    private func refreshSession() async throws {
        if let refreshTask { return try await refreshTask.value }
        guard !session.text("refresh_token").isEmpty else { throw AppFailure(message:"Please sign in again.") }
        if Double(session.number("expires_at")) > Date().timeIntervalSince1970+60 { return }
        let task=Task { @MainActor in
            let result=try await self.request("/auth/v1/token?grant_type=refresh_token",body:["refresh_token":self.session.text("refresh_token")],authenticated:false)
            guard let s=result as? JSON else { throw AppFailure(message:"Please sign in again.") }; try self.setSession(s)
        }
        refreshTask=task; defer { refreshTask=nil }; try await task.value
    }
    func boot() async {
        defer { ready=true }
        guard let data=SecureSession.load(),let saved=(try? JSONSerialization.jsonObject(with:data)) as? JSON else { return }
        session=saved; user=saved.object("user")
        await perform { try await self.load() }
    }
    func authenticate(email:String,password:String,name:String,signup:Bool) async {
        await perform {
            let result=try await self.request(signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password",body:["email":email,"password":password,"data":["display_name":name]],authenticated:false)
            guard let s=result as? JSON else { throw AppFailure(message:"Unexpected sign-in response.") }
            if s.text("access_token").isEmpty { self.message="Check your email to confirm your account, then sign in.";return }
            try self.setSession(s); try await self.load()
        }
    }
    func recover(_ email:String) async {
        await perform { _ = try await self.request("/auth/v1/recover?redirect_to=https%3A%2F%2Fkatheko.vercel.app",body:["email":email],authenticated:false); self.message="Check your email. Reset your password on the web, then sign in here." }
    }
    func load() async throws {
        let result=try await request("/rest/v1/user_state?select=data,updated_at&user_id=eq.\(uid)",method:"GET")
        guard let rows=result as? [JSON] else { throw AppFailure(message:"Unable to load your account. No data was changed.") }
        let row=rows.first ?? [:]
        guard let normalised=call("normalise",[row.object("data"),user,today])?.toDictionary() as? JSON else { throw AppFailure(message:"Unable to read your saved account.") }
        state=normalised; revision=row["updated_at"] as? String
    }
    @discardableResult func rpc(_ name:String,_ body:JSON=[:]) async throws -> Any { try await request("/rest/v1/rpc/katheko_v2_"+name,body:body) }
    func perform(_ action:() async throws -> Void) async {
        guard !busy else { return }; busy=true; defer { busy=false }
        do { try await action() } catch { message=error.localizedDescription.isEmpty ? "Connection failed. Please retry." : error.localizedDescription }
    }
    func save(_ transform:(inout JSON)->Void) async throws {
        guard var next=state else { throw AppFailure(message:"Load your account before editing.") }
        transform(&next)
        let result=try await rpc("save",["payload":next,"expected_revision":revision as Any? ?? NSNull()])
        guard let stamp=result as? String else { throw AppFailure(message:"Unexpected save response. Reload to check your data.") }
        state=next; revision=stamp
    }
    func toggle(_ h:JSON,_ day:String) async {
        guard day<=today,day>=h.text("startDate"),!h.flag("archived") else { return }
        await perform { try await self.save { s in
            var hs=s.rows("habits"); guard let i=hs.firstIndex(where:{$0.text("id")==h.text("id")}) else { return }
            var logs=hs[i].object("logs"); if logs.flag(day) { logs.removeValue(forKey:day) } else { logs[day]=true }
            hs[i]["logs"]=logs;s["habits"]=hs
        } }
    }
    func editHabit(_ original:JSON?,title:String,type:String,target:Int) async -> Bool {
        var success=false
        await perform { try await self.save { s in
            var hs=s.rows("habits")
            if let original,let i=hs.firstIndex(where:{$0.text("id")==original.text("id")}) {
                hs[i]["title"]=title;hs[i]["type"]=type
                if target != hs[i].number("weeklyTarget") {
                    var history=hs[i].rows("targetHistory")
                    if history.isEmpty { history=[["from":hs[i].text("startDate"),"target":hs[i].number("weeklyTarget")]] }
                    let from=self.add(self.monday(self.today),7);history.removeAll{$0.text("from")==from}
                    history.append(["from":from,"target":target]);hs[i]["targetHistory"]=history;hs[i]["weeklyTarget"]=target
                }
            } else { hs.append(["id":UUID().uuidString.lowercased(),"userId":self.uid,"title":title,"type":type,"weeklyTarget":target,"startDate":self.today,"createdAt":ISO8601DateFormatter().string(from:Date()),"logs":JSON()]) }
            s["habits"]=hs
        };success=true };return success
    }
    func archive(_ habit:JSON) async {
        await perform { try await self.save { s in var hs=s.rows("habits");guard let i=hs.firstIndex(where:{$0.text("id")==habit.text("id")}) else{return};hs[i]["archived"] = !habit.flag("archived");if habit.flag("archived"){hs[i].removeValue(forKey:"archivedAt")}else{hs[i]["archivedAt"]=self.today};s["habits"]=hs } }
    }
    func refreshSocial() async throws { social=try await rpc("social") as? JSON ?? [:] }
    func socialAction(_ name:String,_ args:JSON) async { await perform { try await self.rpc(name,args); if name == "resolve" { try await self.load() };try await self.refreshSocial() } }
    func track(_ share:JSON) async {
        let origin=share.text("owner_id")+":"+share.text("habit_id")
        guard !habits.contains(where:{$0.text("sharedOrigin")==origin}) else {message="Already in your habits.";return}
        await perform {
            let id=UUID().uuidString.lowercased(),h=share.object("habit")
            try await self.save { s in var hs=s.rows("habits");hs.append(["id":id,"userId":self.uid,"title":h.text("title"),"type":h.text("type"),"weeklyTarget":Int(self.call("target",[h,self.today])?.toInt32() ?? 1),"startDate":self.today,"createdAt":ISO8601DateFormatter().string(from:Date()),"logs":JSON(),"sharedOrigin":origin]);s["habits"]=hs }
            do { try await self.rpc("share",["habit":id,"friend":share.text("owner_id"),"enabled":true]) } catch { throw AppFailure(message:"Habit added. Sharing failed; use Share to try again.") }
            try await self.refreshSocial()
        }
    }
    func signOut() async { await perform { _ = try? await self.request("/auth/v1/logout");SecureSession.clear();self.session=[:];self.user=[:];self.state=nil;self.social=[:];self.revision=nil } }
    func deleteAccount() async { await perform {
        _ = try await self.request("/functions/v1/katheko-delete-account",body:["confirmation":"DELETE"])
        SecureSession.clear();self.session=[:];self.user=[:];self.state=nil;self.social=[:];self.revision=nil
    } }
}

private let lime=Color(red:0.73,green:0.96,blue:0.47)
@main struct KathekoV2App: App {
    @StateObject private var store=Store()
    var body: some Scene { WindowGroup { RootView().environmentObject(store).tint(lime).preferredColorScheme(.dark).task { await store.boot() } } }
}
struct RootView: View {
    @EnvironmentObject var store:Store
    @Environment(\.scenePhase) private var phase
    var body: some View {
        Group {
            if !store.ready { ProgressView("Opening Katheko…") }
            else if store.state != nil { MainTabs() }
            else if !store.uid.isEmpty { VStack(spacing:20){Text("Your data is safe.").font(.title);Text("We could not load your account. Nothing has been saved.");Button("Retry"){Task{await store.perform{try await store.load()}}};Button("Sign out"){Task{await store.signOut()}}}.padding() }
            else { AuthView() }
        }
        .disabled(store.busy)
        .overlay(alignment:.top){if store.busy{ProgressView().padding().background(.ultraThinMaterial,in:Capsule())}}
        .alert("Katheko",isPresented:Binding(get:{store.message != nil},set:{if !$0{store.message=nil}})){Button("OK"){store.message=nil}}message:{Text(store.message ?? "")}
        .onChange(of:phase){_,new in if new == .active,store.ready,store.state != nil {Task{await store.perform{try await store.load();try await store.refreshSocial()}}}}
    }
}
struct AuthView: View {
    @EnvironmentObject var store:Store
    @State private var email="",password="",name="",signup=false
    var body:some View {
        ScrollView { VStack(alignment:.leading,spacing:24){Text("katheko.").font(.largeTitle.bold());Text(signup ? "Start with one habit." : "Welcome back.").font(.title)
            if signup {TextField("Name",text:$name).textContentType(.name)}
            TextField("Email",text:$email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("Password",text:$password).textContentType(signup ? .newPassword : .password)
            Button(signup ? "Create account" : "Sign in"){Task{await store.authenticate(email:email.trimmingCharacters(in:.whitespaces),password:password,name:name,signup:signup)}}.buttonStyle(.borderedProminent).disabled(email.isEmpty || password.isEmpty || (signup && (password.count<8 || name.isEmpty)))
            Button(signup ? "Already have an account?" : "Create an account"){signup.toggle()}
            Button("Forgot password?"){Task{await store.recover(email)}}.disabled(email.isEmpty)
        }.textFieldStyle(.roundedBorder).padding(28).frame(maxWidth:500)}
    }
}
struct MainTabs: View {
    @State private var selected=0
    var body:some View { TabView(selection:$selected){
        NavigationStack{HabitsView()}.tabItem{Label("Habits",systemImage:"checkmark.circle")}.tag(0)
        NavigationStack{SocialView()}.tabItem{Label("Social",systemImage:"person.2")}.tag(1)
        NavigationStack{AnalyticsView()}.tabItem{Label("Analytics",systemImage:"chart.bar")}.tag(2)
        NavigationStack{ProfileView(connect:{selected=1})}.tabItem{Label("Profile",systemImage:"person.crop.circle")}.tag(3)
    } }
}
struct PeriodPicker:View {
    @EnvironmentObject var store:Store
    @Binding var mode:String;@Binding var date:String;var analytics=false
    var body:some View{VStack{Picker("Period",selection:$mode){if !analytics{Text("Day").tag("day")};Text("Week").tag("week");Text("Month").tag("month")}.pickerStyle(.segmented)
        HStack{Button{date=store.shift(date,mode,-1)}label:{Image(systemName:"chevron.left")}.accessibilityLabel("Previous period");Spacer();Text(mode == "month" ? String(date.prefix(7)) : store.range(date,mode).0).monospacedDigit();Spacer();Button{date=store.shift(date,mode,1)}label:{Image(systemName:"chevron.right")}.accessibilityLabel("Next period").disabled(store.range(date,mode).1>=store.today);Button("Today"){date=store.today}}
    }}
}
struct HabitDays:View {
    @EnvironmentObject var store:Store
    let habit:JSON;let dates:[String];var action:((String)->Void)?=nil
    var body:some View { LazyVGrid(columns:Array(repeating:GridItem(.flexible(),spacing:4),count:7),spacing:8){ForEach(dates,id:\.self){day in
        Button{if let action{action(day)}else{Task{await store.toggle(habit,day)}}}label:{VStack(spacing:5){Text(String(day.suffix(2))).font(.caption);Image(systemName:habit.object("logs").flag(day) ? "checkmark.circle.fill" : "circle").font(.title3)}.frame(maxWidth:.infinity,minHeight:44)}
        .disabled(day>store.today || day<habit.text("startDate") || habit.flag("archived"))
        .accessibilityLabel("\(habit.text("title")), \(day), \(habit.object("logs").flag(day) ? "completed" : "not logged")")
    }} }
}
struct HabitSelection:Identifiable{let id=UUID();var habit:JSON?}
struct HabitsView:View {
    @EnvironmentObject var store:Store
    @State private var mode="week",date="",archived=false
    @State private var editor:HabitSelection?
    var body:some View {List{
        Section{PeriodPicker(mode:$mode,date:$date)}
        ForEach(store.habits.filter{$0.flag("archived")==archived},id:\.selfID){h in
            Section{HStack{VStack(alignment:.leading){Text(h.text("title")).font(.headline);let m=store.metric(h,date,mode);Text("\(m.number("done"))/\(m.number("goal")) this \(mode == "month" ? "month" : "week")").font(.caption).foregroundStyle(.secondary)};Spacer();Button{editor=HabitSelection(habit:h)}label:{Image(systemName:"ellipsis")}.accessibilityLabel("Edit \(h.text("title"))")}
                let r=store.range(date,mode);HabitDays(habit:h,dates:store.days(r.0,r.1))
            }.listRowBackground(Color(white:0.08))
        }
        if store.habits.filter({$0.flag("archived")==archived}).isEmpty{Text(archived ? "No archived habits." : "Start small. Add your first habit.").foregroundStyle(.secondary)}
        Button(archived ? "Active habits" : "Archived habits"){archived.toggle()}
    }.navigationTitle("Make today count.").toolbar{Button{editor=HabitSelection()}label:{Label("Habit",systemImage:"plus")}}
    .sheet(item:$editor){item in HabitEditor(habit:item.habit)}
    .onAppear{if date.isEmpty{date=store.today}}
    .refreshable{await store.perform{try await store.load()}}
    }
}
extension Dictionary where Key==String,Value==Any {var selfID:String{text("id")}}
struct HabitEditor:View {
    @EnvironmentObject var store:Store;@Environment(\.dismiss) var dismiss
    var habit:JSON?
    @State private var title="",type="build",target=4,confirmArchive=false
    var body:some View{NavigationStack{Form{TextField("Habit name",text:$title);Picker("Direction",selection:$type){Text("Build").tag("build");Text("Break").tag("break")};Stepper("\(target) days per week",value:$target,in:1...7)
        if habit != nil{Text("Target changes begin next Monday. Earlier weeks keep their targets.").font(.caption);Button(habit!.flag("archived") ? "Restore habit" : "Archive habit"){confirmArchive=true}}
    }.navigationTitle(habit == nil ? "New habit" : "Edit habit").toolbar{ToolbarItem(placement:.cancellationAction){Button("Cancel"){dismiss()}};ToolbarItem(placement:.confirmationAction){Button("Save"){Task{if await store.editHabit(habit,title:title.trimmingCharacters(in:.whitespacesAndNewlines),type:type,target:target){dismiss()}}}.disabled(title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || title.count>80)}}
    .confirmationDialog("Keep this habit's history and change its archive status?",isPresented:$confirmArchive){Button("Confirm"){if let habit{Task{await store.archive(habit);dismiss()}}}}
    .onAppear{if let habit{title=habit.text("title");type=habit.text("type");target=habit.number("weeklyTarget")}}
    }}
}
struct AnalyticsView:View {
    @EnvironmentObject var store:Store
    @State private var mode="week",date=""
    var rows:[JSON]{store.habits.filter{!$0.flag("archived")}}
    var body:some View{List{Section{PeriodPicker(mode:$mode,date:$date,analytics:true)}
        let metrics=rows.map{store.metric($0,date,mode)},eligible=metrics.filter{$0.number("goal")>0}
        let goal=eligible.reduce(0){$0+$1.number("goal")},done=eligible.reduce(0){$0+min($1.number("done"),$1.number("goal"))}
        Section(mode == "month" ? "Monthly progress" : "Weekly progress"){
            LabeledContent("Target progress",value:"\(goal>0 ? Int((Double(done)/Double(goal)*100).rounded()) : 0)%")
            LabeledContent("Logs",value:"\(metrics.reduce(0){$0+$1.number("done")})")
            LabeledContent("Targets met",value:"\(eligible.filter{$0.flag("met")}.count) / \(eligible.count)")
        }
        Section(mode == "month" ? "Monthly targets" : "Weekly targets"){ForEach(rows,id:\.selfID){h in let m=store.metric(h,date,mode);VStack(alignment:.leading){LabeledContent(h.text("title"),value:"\(m.number("done")) / \(m.number("goal"))");ProgressView(value:Double(m.number("percent")),total:100)}}}
        Section("Daily activity"){let r=store.range(date,mode);ForEach(store.days(r.0,min(r.1,store.today)),id:\.self){d in LabeledContent(d,value:"\(rows.reduce(0){$0+Int(store.call("count",[$1,d,d])?.toInt32() ?? 0)}) logs")}}
        DisclosureGroup("About these numbers"){Text("Weeks run Monday–Sunday. Monthly targets sum each eligible day's weekly target divided by seven, rounded up once. Future days never count as completed. Weekly streaks and points are unchanged by this view.").font(.caption)}
    }.navigationTitle("See your rhythm.").onAppear{if date.isEmpty{date=store.today}}.refreshable{await store.perform{try await store.load()}}}
}

struct SocialSheet: Identifiable { let id=UUID();let kind:String;let data:JSON }
struct SocialView:View {
    @EnvironmentObject var store:Store
    @State private var query="",results:[JSON]=[]
    @State private var sheet:SocialSheet?
    @State private var revoke:JSON?
    var body:some View{List{
        Section{HStack{TextField("Name or username",text:$query).autocorrectionDisabled();Button("Find"){Task{await store.perform{results=try await store.rpc("search",["query":query]) as? [JSON] ?? []}}}.disabled(query.trimmingCharacters(in:.whitespaces).count<2)}
            ForEach(results,id:\.selfID){p in HStack{Text(p.text("display_name").isEmpty ? p.text("username") : p.text("display_name"));Spacer();Button("Connect"){Task{await store.socialAction("friend",["other_id":p.text("id")]);results=[]}}}}
        }
        if !store.social.rows("incoming").isEmpty || !store.social.rows("outgoing").isEmpty {Section("Requests"){
            ForEach(store.social.rows("incoming"),id:\.selfID){p in VStack(alignment:.leading){Text(p.text("name"));HStack{Button("Accept"){respond(p,"accept")};Button("Decline"){respond(p,"decline")}}}
            ForEach(store.social.rows("outgoing"),id:\.selfID){p in HStack{Text(p.text("name"));Spacer();Button("Cancel"){respond(p,"cancel")}}}
        }}
        Section("Friends"){ForEach(store.social.rows("friends"),id:\.selfID){f in VStack(alignment:.leading,spacing:10){HStack{Text(f.text("name")).font(.headline);Spacer();Button("Share"){sheet=SocialSheet(kind:"share",data:f)}};Text("\(f.number("xp")) points · \(f.number("myGain")-f.number("gain")) your lead").font(.caption);Text("\(max(0,min(f.number("myGain"),f.number("gain")))) points together since connecting").font(.caption).foregroundStyle(.secondary)}}
            if store.social.rows("friends").isEmpty{Text("Find your first accountability partner.").foregroundStyle(.secondary)}
        }
        Section("Shared with you"){ForEach(store.social.rows("shares").filter{$0.text("owner_id") != store.uid},id:\.shareID){s in VStack(alignment:.leading,spacing:12){Text(s.object("habit").text("title")).font(.headline);Text(s.text("owner_name")).font(.caption);HabitDays(habit:s.object("habit"),dates:store.days(store.monday(store.today),store.add(store.monday(store.today),6)),action:{day in var data=s;data["date"]=day;sheet=SocialSheet(kind:"suggest",data:data)});Button("Track this together"){Task{await store.track(s)}}}}}
        Section("Sharing permissions"){ForEach(store.social.rows("shares").filter{$0.text("owner_id")==store.uid},id:\.shareID){s in HStack{Text(s.object("habit").text("title")+" → "+s.text("friend_name"));Spacer();Button("Stop sharing"){revoke=s}}}}
        Section("Edit history"){ForEach(store.social.rows("edits"),id:\.selfID){e in VStack(alignment:.leading,spacing:8){Text("\(e.text("actor_name")) · \(e.text("log_date"))").font(.headline);Text(e.flag("completed") ? "Suggested completed" : "Suggested not completed").font(.caption);Text(e.text("reason"));Text(e.text("status").capitalized).foregroundStyle(lime);if e.text("owner_id")==store.uid && e.text("status")=="pending"{HStack{Button("Apply"){resolve(e,true)};Button("Decline"){resolve(e,false)}}}}}
        DisclosureGroup("Points and accountability"){Text("10 points per logged day, plus 30 when a weekly target is met. Undoing a log recalculates points. Friends only see habits you share. You approve their corrections.").font(.caption)}
    }.navigationTitle("Better together.")
    .toolbar{Button{Task{await store.perform{try await store.refreshSocial()}}}label:{Image(systemName:"arrow.clockwise")}.accessibilityLabel("Refresh friends")}
    .task{await store.perform{try await store.refreshSocial()}}
    .refreshable{await store.perform{try await store.refreshSocial()}}
    .sheet(item:$sheet){s in SocialEditor(sheet:s)}
    .confirmationDialog("Stop sharing this habit?",isPresented:Binding(get:{revoke != nil},set:{if !$0{revoke=nil}})){Button("Stop sharing",role:.destructive){if let s=revoke{Task{await store.socialAction("share",["habit":s.text("habit_id"),"friend":s.text("friend_id"),"enabled":false])}};revoke=nil}}
    }
    func respond(_ p:JSON,_ decision:String){Task{await store.socialAction("respond",["request_id":p.text("id"),"decision":decision])}}
    func resolve(_ e:JSON,_ accept:Bool){Task{await store.socialAction("resolve",["edit_id":e.text("id"),"accept_edit":accept])}}
}
extension Dictionary where Key==String,Value==Any{var shareID:String{text("owner_id")+":"+text("friend_id")+":"+text("habit_id")}}
struct SocialEditor:View {
    @EnvironmentObject var store:Store;@Environment(\.dismiss) var dismiss
    let sheet:SocialSheet
    @State private var habit="",reason=""
    var body:some View{NavigationStack{Form{
        if sheet.kind == "share"{Picker("Habit",selection:$habit){ForEach(store.habits.filter{!$0.flag("archived")},id:\.selfID){h in Text(h.text("title")).tag(h.text("id"))}};Text("Your friend sees this habit's history and can suggest corrections. You approve each change.").font(.caption)}
        else{Text(sheet.data.object("habit").text("title"));Text(sheet.data.text("date"));Text(sheet.data.object("habit").object("logs").flag(sheet.data.text("date")) ? "Suggest not completed" : "Suggest completed");TextField("Reason",text:$reason,axis:.vertical)}
    }.navigationTitle(sheet.kind == "share" ? "Share a habit" : "Suggest correction")
    .toolbar{ToolbarItem(placement:.cancellationAction){Button("Cancel"){dismiss()}};ToolbarItem(placement:.confirmationAction){Button("Send"){Task{var sent=false;await store.perform{
        if sheet.kind == "share"{try await store.rpc("share",["habit":habit,"friend":sheet.data.text("id"),"enabled":true])}
        else{try await store.rpc("suggest",["owner":sheet.data.text("owner_id"),"habit":sheet.data.text("habit_id"),"log_day":sheet.data.text("date"),"done": !sheet.data.object("habit").object("logs").flag(sheet.data.text("date")),"note":reason.trimmingCharacters(in:.whitespacesAndNewlines)])}
        try await store.refreshSocial();sent=true
    };if sent{dismiss()}}}.disabled(sheet.kind == "share" ? habit.isEmpty : reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || reason.count>240)}}
    .onAppear{habit=store.habits.first(where:{!$0.flag("archived")})?.text("id") ?? ""}
    }}
}
struct AccountExport:FileDocument {
    static var readableContentTypes:[UTType]{[.json]}
    var data:Data
    init(data:Data){self.data=data}
    init(configuration:ReadConfiguration)throws{data=configuration.file.regularFileContents ?? Data()}
    func fileWrapper(configuration:WriteConfiguration)throws->FileWrapper{FileWrapper(regularFileWithContents:data)}
}
struct ProfileView:View {
    @EnvironmentObject var store:Store
    var connect:()->Void
    @State private var export=false,signout=false,deleteConfirmation=false
    @State private var deletePhrase=""
    @State private var timezone="Europe/London"
    var body:some View{List{
        Section{Text(store.state?.rows("users").first?.text("name") ?? "You").font(.title);Text(store.user.text("email")).foregroundStyle(.secondary)}
        Section("Your progress"){LabeledContent("Habit points",value:"\(store.points)");LabeledContent("Level",value:"\(Int(sqrt(Double(store.points)/100))+1)");LabeledContent("Accountability partners",value:"\(store.social.rows("friends").count)");Button("Connect with friends",action:connect)}
        Section("Points"){LabeledContent("Log a habit",value:"+10");LabeledContent("Reach its weekly target",value:"+30");DisclosureGroup("Previous progress"){Text("V1 seasons, loops, notes and XP remain in your account export. V2 points use the simpler rules above.")}}
        Section("Calendar"){Picker("Account timezone",selection:$timezone){ForEach(TimeZone.knownTimeZoneIdentifiers,id:\.self){Text($0).tag($0)}};Button("Save timezone"){Task{await store.perform{try await store.save{$0["timezone"]=timezone}}}}}
        Section("Your data"){Button("Export account"){export=true};Button("Reload cloud data"){Task{await store.perform{try await store.load();try await store.refreshSocial()}}};Button("Sign out",role:.destructive){signout=true};Button("Delete account",role:.destructive){deletePhrase="";deleteConfirmation=true}}
    }.navigationTitle("Your space.").onAppear{timezone=store.state?.text("timezone") ?? "Europe/London"}
    .task{await store.perform{try await store.refreshSocial()}}
    .confirmationDialog("Sign out?",isPresented:$signout){Button("Sign out",role:.destructive){Task{await store.signOut()}}}
    .alert("Permanently delete your account?",isPresented:$deleteConfirmation){TextField("Type DELETE",text:$deletePhrase);Button("Cancel",role:.cancel){};Button("Delete",role:.destructive){Task{await store.deleteAccount()}}.disabled(deletePhrase != "DELETE")}message:{Text("Your account, habits, friendships and archived records will be removed. This cannot be undone.")}
    .fileExporter(isPresented:$export,document:AccountExport(data:(try? JSONSerialization.data(withJSONObject:store.state ?? [:],options:[.prettyPrinted,.sortedKeys])) ?? Data()),contentType:.json,defaultFilename:"katheko-account-\(store.today)"){result in if case .failure(let e)=result{store.message=e.localizedDescription}}
    }
}
